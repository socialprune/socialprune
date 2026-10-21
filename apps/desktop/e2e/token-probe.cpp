// Diagnostic only. Built separately from every shipped entrypoint.
// Win32 calls are probes, not Chromium code copied into this project.
// Recipe authority, Chromium 152.0.7977.167:
// content/browser/gpu/gpu_process_host.cc: USER_LIMITED primary token;
// sandbox/win/src/restricted_token_utils.cc: deny-only exceptions/restrict SIDs;
// sandbox/win/src/restricted_token.cc: CreateRestricted, default DACL, integrity;
// base/win/access_token.cc: OpenProcessToken and DuplicateHandle ALL_ACCESS.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <aclapi.h>
#include <sddl.h>
#include <algorithm>
#include <cstdint>
#include <utility>
#include <string>
#include <vector>

namespace {
HANDLE output = INVALID_HANDLE_VALUE;
ULONGLONG started = 0;
std::string actor;
std::string ascii(const std::wstring& value) {
  std::string result;
  for (wchar_t c : value) result += c >= 32 && c < 127 ? static_cast<char>(c) : '?';
  return result;
}

std::string quote(const std::string& value) {
  std::string result = "\"";
  for (char c : value) {
    if (c == '\\' || c == '"') result += '\\';
    if (static_cast<unsigned char>(c) >= 32) result += c;
  }
  return result + '"';
}
void record(const std::string& event, const std::string& fields) {
  const std::string row = "{\"version\":1,\"diagnosticOnly\":true,\"acceptance\":false,\"actor\":" +
    quote(actor) + ",\"elapsedMs\":" + std::to_string(GetTickCount64() - started) +
    ",\"event\":" + quote(event) + (fields.empty() ? "" : "," + fields) + "}\n";
  DWORD bytes = 0;
  if (!WriteFile(output, row.data(), static_cast<DWORD>(row.size()), &bytes, nullptr) || bytes != row.size()) ExitProcess(70);
  if (!FlushFileBuffers(output)) ExitProcess(71);
}
std::string unknown(DWORD error) {
  return "{\"state\":\"unknown\",\"error\":" + std::to_string(error) + "}";
}
std::string known(const std::string& value) { return "{\"state\":\"known\",\"value\":" + value + "}"; }
void step(const char* operation, bool ok, DWORD error, const std::string& extra = "") {
  record("call", "\"operation\":" + quote(operation) + ",\"state\":" + quote(ok ? "ok" : "failed") +
    ",\"error\":" + (ok ? "null" : std::to_string(error)) + (extra.empty() ? "" : "," + extra));
}
std::vector<BYTE> info(HANDLE token, TOKEN_INFORMATION_CLASS kind, DWORD& error) {
  DWORD size = 0;
  BOOL ok = GetTokenInformation(token, kind, nullptr, 0, &size);
  error = ok ? ERROR_SUCCESS : GetLastError();
  if (!size || (!ok && error != ERROR_INSUFFICIENT_BUFFER)) return {};
  std::vector<BYTE> bytes(size);
  ok = GetTokenInformation(token, kind, bytes.data(), size, &size);
  error = ok ? ERROR_SUCCESS : GetLastError();
  if (!ok) return {};
  return bytes;
}
std::string sid(PSID value, PSID user, DWORD attributes = 0) {
  if (!value || !IsValidSid(value)) return "unknown";
  if (user && EqualSid(value, user)) return "user";
  if ((attributes & SE_GROUP_LOGON_ID) == SE_GROUP_LOGON_ID) return "logon";
  LPWSTR text = nullptr;
  if (!ConvertSidToStringSidW(value, &text)) return "unknown";
  const std::wstring raw(text); LocalFree(text);
  if (raw.rfind(L"S-1-5-5-", 0) == 0) return "logon";
  // Only fixed well-known SID families may be emitted. Domain, machine,
  // service and app-container identifiers never leave this helper.
  const std::vector<std::wstring> fixed = {
    L"S-1-0-0", L"S-1-1-0", L"S-1-2-0", L"S-1-2-1", L"S-1-3-0", L"S-1-3-1", L"S-1-3-4",
    L"S-1-5-2", L"S-1-5-4", L"S-1-5-6", L"S-1-5-7", L"S-1-5-9", L"S-1-5-10", L"S-1-5-11",
    L"S-1-5-12", L"S-1-5-14", L"S-1-5-15", L"S-1-5-18", L"S-1-5-19", L"S-1-5-20", L"S-1-5-33",
    L"S-1-5-32-544", L"S-1-5-32-545", L"S-1-5-32-546", L"S-1-5-32-547", L"S-1-5-32-551",
    L"S-1-16-0", L"S-1-16-4096", L"S-1-16-8192", L"S-1-16-8448", L"S-1-16-12288", L"S-1-16-16384",
    L"S-1-15-2-1", L"S-1-15-2-2"
  };
  if (std::find(fixed.begin(), fixed.end(), raw) != fixed.end()) return ascii(raw);
  return "other";
}
std::string acl(PACL value, PSID user) {
  if (!value) return "{\"state\":\"null-dacl\"}";
  if (!IsValidAcl(value)) return unknown(ERROR_INVALID_ACL);
  std::string result = "[";
  for (DWORD i = 0; i < value->AceCount; ++i) {
    void* raw = nullptr;
    BOOL ok = GetAce(value, i, &raw); DWORD error = ok ? ERROR_SUCCESS : GetLastError();
    if (!ok) return unknown(error);
    const ACE_HEADER* header = static_cast<ACE_HEADER*>(raw);
    const bool ordinary = header->AceType == ACCESS_ALLOWED_ACE_TYPE || header->AceType == ACCESS_DENIED_ACE_TYPE ||
      header->AceType == SYSTEM_MANDATORY_LABEL_ACE_TYPE || header->AceType == SYSTEM_AUDIT_ACE_TYPE;
    if (i) result += ',';
    result += "{\"type\":" + std::to_string(header->AceType) + ",\"flags\":" + std::to_string(header->AceFlags);
    if (ordinary && header->AceSize >= 16) {
      auto entry = static_cast<ACCESS_ALLOWED_ACE*>(raw);
      result += ",\"mask\":" + std::to_string(entry->Mask) + ",\"sid\":" + quote(sid(&entry->SidStart, user));
    } else result += ",\"mask\":null,\"sid\":\"unknown\"";
    result += '}';
  }
  return known(result + ']');
}
std::string security(HANDLE token, SECURITY_INFORMATION requested, PSID user) {
  PSECURITY_DESCRIPTOR descriptor = nullptr; PSID owner = nullptr; PACL dacl = nullptr, sacl = nullptr;
  DWORD error = GetSecurityInfo(token, SE_KERNEL_OBJECT, requested, &owner, nullptr, &dacl, &sacl, &descriptor);
  if (error != ERROR_SUCCESS) return unknown(error);
  std::string result;
  if (requested == OWNER_SECURITY_INFORMATION) result = known(quote(sid(owner, user)));
  else if (requested == DACL_SECURITY_INFORMATION) result = acl(dacl, user);
  else result = sacl ? acl(sacl, user) : "{\"state\":\"absent\"}";
  LocalFree(descriptor); return result;
}
void snapshot(HANDLE token, const char* target) {
  DWORD error = 0; auto userBytes = info(token, TokenUser, error);
  PSID user = userBytes.empty() ? nullptr : reinterpret_cast<TOKEN_USER*>(userBytes.data())->User.Sid;
  record("snapshot-begin", "\"target\":" + quote(target));
  for (auto kind : {TokenUser, TokenOwner, TokenPrimaryGroup, TokenGroups, TokenPrivileges, TokenIntegrityLevel,
    TokenMandatoryPolicy, TokenRestrictedSids, TokenElevationType, TokenDefaultDacl}) {
    auto bytes = info(token, kind, error);
    std::string value = unknown(error), name;
    switch (kind) {
      case TokenUser: name = "TokenUser"; break; case TokenOwner: name = "TokenOwner"; break;
      case TokenPrimaryGroup: name = "TokenPrimaryGroup"; break; case TokenGroups: name = "TokenGroups"; break;
      case TokenPrivileges: name = "TokenPrivileges"; break; case TokenIntegrityLevel: name = "TokenIntegrityLevel"; break;
      case TokenMandatoryPolicy: name = "TokenMandatoryPolicy"; break; case TokenRestrictedSids: name = "TokenRestrictedSids"; break;
      case TokenElevationType: name = "TokenElevationType"; break; case TokenDefaultDacl: name = "TokenDefaultDacl"; break;
      default: break;
    }
    if (!bytes.empty()) {
      if (kind == TokenUser || kind == TokenIntegrityLevel) {
        const auto item = reinterpret_cast<SID_AND_ATTRIBUTES*>(bytes.data());
        value = known("{\"sid\":" + quote(sid(item->Sid, user, item->Attributes)) + ",\"attributes\":" + std::to_string(item->Attributes) + "}");
      } else if (kind == TokenOwner || kind == TokenPrimaryGroup) value = known(quote(sid(*reinterpret_cast<PSID*>(bytes.data()), user)));
      else if (kind == TokenDefaultDacl) value = acl(reinterpret_cast<TOKEN_DEFAULT_DACL*>(bytes.data())->DefaultDacl, user);
      else if (kind == TokenMandatoryPolicy || kind == TokenElevationType) value = known(std::to_string(*reinterpret_cast<DWORD*>(bytes.data())));
      else if (kind == TokenPrivileges) {
        const auto privileges = reinterpret_cast<TOKEN_PRIVILEGES*>(bytes.data()); std::string items = "[";
        for (DWORD i = 0; i < privileges->PrivilegeCount; ++i) {
          const auto& p = privileges->Privileges[i]; WCHAR buffer[128]; DWORD length = 128;
          BOOL ok = LookupPrivilegeNameW(nullptr, const_cast<LUID*>(&p.Luid), buffer, &length);
          DWORD code = ok ? ERROR_SUCCESS : GetLastError();
          std::string privilege = ok ? ascii(std::wstring(buffer, length)) : "unknown";
          if (i) items += ',';
          items += "{\"name\":" + quote(privilege) + ",\"attributes\":" + std::to_string(p.Attributes) + ",\"error\":" + (ok ? "null" : std::to_string(code)) + "}";
        }
        value = known(items + ']');
      } else {
        const auto groups = reinterpret_cast<TOKEN_GROUPS*>(bytes.data()); std::string items = "[";
        for (DWORD i = 0; i < groups->GroupCount; ++i) {
          const auto& g = groups->Groups[i]; if (i) items += ',';
          items += "{\"sid\":" + quote(sid(g.Sid, user, g.Attributes)) + ",\"attributes\":" + std::to_string(g.Attributes) + "}";
        }
        value = known(items + ']');
      }
    }
    record("field", "\"target\":" + quote(target) + ",\"field\":" + quote(name) + ",\"result\":" + value);
  }
  for (auto item : {std::pair<SECURITY_INFORMATION, const char*>{OWNER_SECURITY_INFORMATION,"ObjectOwner"},
    {DACL_SECURITY_INFORMATION,"ObjectDacl"}, {LABEL_SECURITY_INFORMATION,"ObjectMandatoryLabel"}})
    record("field", "\"target\":" + quote(target) + ",\"field\":" + quote(item.second) + ",\"result\":" + security(token, item.first, user));
  record("snapshot-end", "\"target\":" + quote(target));
}
bool userAce(HANDLE token, bool object) {
  DWORD error = 0; auto bytes = info(token, TokenUser, error);
  if (bytes.empty()) { step("Variant.TokenUser", false, error); return false; }
  PSID user = reinterpret_cast<TOKEN_USER*>(bytes.data())->User.Sid;
  PACL original = nullptr, merged = nullptr; PSECURITY_DESCRIPTOR descriptor = nullptr;
  auto defaultBytes = object ? std::vector<BYTE>{} : info(token, TokenDefaultDacl, error);
  if (object) error = GetSecurityInfo(token, SE_KERNEL_OBJECT, DACL_SECURITY_INFORMATION, nullptr, nullptr, &original, nullptr, &descriptor);
  else if (!defaultBytes.empty()) original = reinterpret_cast<TOKEN_DEFAULT_DACL*>(defaultBytes.data())->DefaultDacl;
  if (error != ERROR_SUCCESS) { step("Variant.ReadDacl", false, error); if (descriptor) LocalFree(descriptor); return false; }
  EXPLICIT_ACCESSW ace{}; ace.grfAccessPermissions = GENERIC_ALL; ace.grfAccessMode = GRANT_ACCESS;
  ace.Trustee.TrusteeForm = TRUSTEE_IS_SID; ace.Trustee.TrusteeType = TRUSTEE_IS_USER; ace.Trustee.ptstrName = static_cast<LPWSTR>(user);
  error = SetEntriesInAclW(1, &ace, original, &merged);
  bool ok = error == ERROR_SUCCESS;
  if (ok && object) { error = SetSecurityInfo(token, SE_KERNEL_OBJECT, DACL_SECURITY_INFORMATION, nullptr, nullptr, merged, nullptr); ok = error == ERROR_SUCCESS; }
  else if (ok) { TOKEN_DEFAULT_DACL value{merged}; ok = !!SetTokenInformation(token, TokenDefaultDacl, &value, sizeof(value)); error = ok ? ERROR_SUCCESS : GetLastError(); }
  step(object ? "Variant.ObjectDaclUserAce" : "Variant.DefaultDaclUserAce", ok, error);
  if (merged) LocalFree(merged); if (descriptor) LocalFree(descriptor); return ok;
}
int labelVariant(HANDLE token) {
  PSECURITY_DESCRIPTOR descriptor = nullptr; PACL sacl = nullptr;
  DWORD error = GetSecurityInfo(token, SE_KERNEL_OBJECT, LABEL_SECURITY_INFORMATION, nullptr, nullptr, nullptr, &sacl, &descriptor);
  if (error != ERROR_SUCCESS) { step("Variant.ReadObjectLabel", false, error); return 2; }
  bool differs = false;
  if (sacl) for (DWORD i = 0; i < sacl->AceCount; ++i) {
    void* raw = nullptr; BOOL ok = GetAce(sacl, i, &raw); error = ok ? ERROR_SUCCESS : GetLastError();
    if (!ok) { LocalFree(descriptor); step("Variant.ReadObjectLabelAce", false, error); return 2; }
    auto entry = static_cast<SYSTEM_MANDATORY_LABEL_ACE*>(raw);
    if (entry->Header.AceType == SYSTEM_MANDATORY_LABEL_ACE_TYPE) {
      PSID value = &entry->SidStart;
      DWORD rid = *GetSidSubAuthority(value, *GetSidSubAuthorityCount(value) - 1);
      if (rid != SECURITY_MANDATORY_MEDIUM_RID) { *GetSidSubAuthority(value, *GetSidSubAuthorityCount(value) - 1) = SECURITY_MANDATORY_MEDIUM_RID; differs = true; }
    }
  }
  if (!differs) { LocalFree(descriptor); record("variant", "\"state\":\"not-applicable\",\"reason\":\"object-label-does-not-differ\""); return 3; }
  error = SetSecurityInfo(token, SE_KERNEL_OBJECT, LABEL_SECURITY_INFORMATION, nullptr, nullptr, nullptr, sacl);
  LocalFree(descriptor); step("Variant.ObjectLabelMedium", error == ERROR_SUCCESS, error); return error == ERROR_SUCCESS ? 0 : 2;
}
void chain() {
  HANDLE all = nullptr;
  for (DWORD mask : {DWORD(TOKEN_QUERY), DWORD(TOKEN_QUERY | TOKEN_DUPLICATE), DWORD(TOKEN_QUERY | TOKEN_DUPLICATE | TOKEN_IMPERSONATE), DWORD(TOKEN_ALL_ACCESS)}) {
    HANDLE handle = nullptr; BOOL ok = OpenProcessToken(GetCurrentProcess(), mask, &handle); DWORD error = ok ? ERROR_SUCCESS : GetLastError();
    step("OpenProcessToken", !!ok, error, "\"access\":" + std::to_string(mask));
    if (mask == TOKEN_ALL_ACCESS) all = handle; else if (handle) CloseHandle(handle);
  }
  if (!all) { record("chain-end", "\"state\":\"blocked\",\"dependency\":\"OpenProcessToken.ALL_ACCESS\""); return; }
  DWORD error = 0; auto groupsBytes = info(all, TokenGroups, error);
  if (groupsBytes.empty()) { step("BuildGpuGroups", false, error); CloseHandle(all); return; }
  auto userBytes = info(all, TokenUser, error);
  if (userBytes.empty()) { step("BuildGpuUser", false, error); CloseHandle(all); return; }
  PSID user = reinterpret_cast<TOKEN_USER*>(userBytes.data())->User.Sid;
  const auto groups = reinterpret_cast<TOKEN_GROUPS*>(groupsBytes.data());
  std::vector<SID_AND_ATTRIBUTES> deny, restricts; std::vector<PSID> allocated;
  for (DWORD i = 0; i < groups->GroupCount; ++i) {
    const auto& g = groups->Groups[i];
    if (!(g.Attributes & SE_GROUP_INTEGRITY) && (g.Attributes & SE_GROUP_LOGON_ID) != SE_GROUP_LOGON_ID &&
      !IsWellKnownSid(g.Sid, WinBuiltinUsersSid) && !IsWellKnownSid(g.Sid, WinWorldSid) && !IsWellKnownSid(g.Sid, WinInteractiveSid)) deny.push_back({g.Sid,0});
    if ((g.Attributes & SE_GROUP_LOGON_ID) == SE_GROUP_LOGON_ID) restricts.push_back({g.Sid,0});
  }
  for (WELL_KNOWN_SID_TYPE kind : {WinBuiltinUsersSid, WinWorldSid, WinRestrictedCodeSid}) {
    DWORD length = SECURITY_MAX_SID_SIZE; PSID value = LocalAlloc(LMEM_FIXED, length);
    BOOL ok = CreateWellKnownSid(kind, nullptr, value, &length); error = ok ? ERROR_SUCCESS : GetLastError();
    if (!ok) { step("BuildGpuKnownSid", false, error); LocalFree(value); for (PSID p : allocated) LocalFree(p); CloseHandle(all); return; }
    allocated.push_back(value); restricts.push_back({value,0});
  }
  PSID randomSid = nullptr; SID_IDENTIFIER_AUTHORITY nt = SECURITY_NT_AUTHORITY;
  // Disposable random restriction identity, never emitted or persisted.
  LARGE_INTEGER counter{}; QueryPerformanceCounter(&counter);
  BOOL randomOk = AllocateAndInitializeSid(&nt, 5, 21, GetCurrentProcessId(), counter.LowPart, static_cast<DWORD>(counter.HighPart), GetTickCount(), 0, 0, 0, &randomSid);
  error = randomOk ? ERROR_SUCCESS : GetLastError();
  if (randomOk) restricts.push_back({randomSid,0}); else {
    step("BuildGpuRandomSid", false, error); for (PSID p : allocated) LocalFree(p); CloseHandle(all); return;
  }
  record("recipe", "\"chromium\":\"152.0.7977.167\",\"primary\":\"USER_LIMITED\",\"flags\":1,\"lockdownDefaultDacl\":true,\"uniqueRestriction\":true,\"integrity\":\"low-probe-runtime-may-delay\",\"isolationSecurityAttribute\":\"not-emulated\",\"exactChromiumExecution\":false");
  HANDLE restricted = nullptr, duplicate = nullptr;
  BOOL ok = randomOk && CreateRestrictedToken(all, DISABLE_MAX_PRIVILEGE, static_cast<DWORD>(deny.size()), deny.data(), 0, nullptr, static_cast<DWORD>(restricts.size()), restricts.data(), &restricted);
  error = ok ? ERROR_SUCCESS : GetLastError(); step("CreateRestrictedToken.GpuPrimary", !!ok, error);
  if (ok) {
    ok = DuplicateHandle(GetCurrentProcess(), restricted, GetCurrentProcess(), &duplicate, TOKEN_ALL_ACCESS, FALSE, 0);
    error = ok ? ERROR_SUCCESS : GetLastError(); step("DuplicateHandle.ALL_ACCESS", !!ok, error);
    if (ok) {
      auto defaultBytes = info(duplicate, TokenDefaultDacl, error); step("GetTokenInformation.TokenDefaultDacl", !defaultBytes.empty(), error);
      if (!defaultBytes.empty()) {
        std::vector<EXPLICIT_ACCESSW> entries;
        for (DWORD i = 0; i < groups->GroupCount; ++i) if ((groups->Groups[i].Attributes & SE_GROUP_LOGON_ID) == SE_GROUP_LOGON_ID) {
          EXPLICIT_ACCESSW e{}; e.grfAccessMode = REVOKE_ACCESS; e.Trustee.TrusteeForm = TRUSTEE_IS_SID; e.Trustee.ptstrName = static_cast<LPWSTR>(groups->Groups[i].Sid); entries.push_back(e);
        }
        PSID ownerRights = nullptr; BOOL made = ConvertStringSidToSidW(L"S-1-3-4", &ownerRights); DWORD madeError = made ? ERROR_SUCCESS : GetLastError();
        step("BuildGpuOwnerRightsSid", !!made, madeError);
        for (const auto& pair : {std::pair<PSID,DWORD>{user,GENERIC_ALL},{randomSid,GENERIC_ALL},{ownerRights,READ_CONTROL}}) {
          if (!pair.first) continue; EXPLICIT_ACCESSW e{}; e.grfAccessMode = GRANT_ACCESS; e.grfAccessPermissions = pair.second;
          e.Trustee.TrusteeForm = TRUSTEE_IS_SID; e.Trustee.ptstrName = static_cast<LPWSTR>(pair.first); entries.push_back(e);
        }
        PACL merged = nullptr;
        error = SetEntriesInAclW(static_cast<ULONG>(entries.size()), entries.data(), reinterpret_cast<TOKEN_DEFAULT_DACL*>(defaultBytes.data())->DefaultDacl, &merged);
        step("MergeGpuDefaultDacl", error == ERROR_SUCCESS, error);
        if (error == ERROR_SUCCESS) { TOKEN_DEFAULT_DACL dacl{merged}; ok = SetTokenInformation(duplicate, TokenDefaultDacl, &dacl, sizeof(dacl)); error = ok ? ERROR_SUCCESS : GetLastError(); step("SetTokenInformation.TokenDefaultDacl", !!ok, error); LocalFree(merged); }
        if (ownerRights) LocalFree(ownerRights);
      }
      PSID low = nullptr; ok = ConvertStringSidToSidW(L"S-1-16-4096", &low); error = ok ? ERROR_SUCCESS : GetLastError();
      step("BuildLowIntegritySid", !!ok, error);
      if (ok) { TOKEN_MANDATORY_LABEL label{{low,SE_GROUP_INTEGRITY}}; ok = SetTokenInformation(duplicate, TokenIntegrityLevel, &label, sizeof(label)); error = ok ? ERROR_SUCCESS : GetLastError(); step("SetTokenInformation.IntegrityLow", !!ok, error); LocalFree(low); }
      snapshot(duplicate, "gpu-primary-probe");
      // USER_LIMITED keeps traversal; this additional destructive check acts on
      // this disposable token only and is not claimed as a GPU recipe step.
      auto privileges = info(duplicate, TokenPrivileges, error);
      if (!privileges.empty()) { auto p = reinterpret_cast<TOKEN_PRIVILEGES*>(privileges.data()); for (DWORD i = 0; i < p->PrivilegeCount; ++i) p->Privileges[i].Attributes = SE_PRIVILEGE_REMOVED;
        SetLastError(ERROR_SUCCESS); ok = AdjustTokenPrivileges(duplicate,FALSE,p,0,nullptr,nullptr); error = GetLastError();
        step("AdjustTokenPrivileges.RemoveAll", !!ok && error != ERROR_NOT_ALL_ASSIGNED, error, "\"gpuRecipeStep\":false"); }
    }
  }
  if (duplicate) CloseHandle(duplicate); if (restricted) CloseHandle(restricted); CloseHandle(all);
  for (PSID p : allocated) LocalFree(p); if (randomSid) FreeSid(randomSid);
  record("chain-end", "\"state\":\"returned\"");
}
std::vector<std::wstring> arguments() {
  std::vector<std::wstring> result; std::wstring text = GetCommandLineW(), word; bool quoted = false;
  for (wchar_t c : text) { if (c == L'"') quoted = !quoted; else if ((c == L' ' || c == L'\t') && !quoted) { if (!word.empty()) { result.push_back(word); word.clear(); } } else word += c; }
  if (!word.empty()) result.push_back(word); return result;
}
}
int WINAPI wWinMain(HINSTANCE, HINSTANCE, PWSTR, int) {
  started = GetTickCount64(); const auto args = arguments();
  if (args.size() != 5) return 64;
  actor = args[1] == L"owner" ? "owner" : "restricted-helper";
  output = CreateFileW(args[2].c_str(), FILE_APPEND_DATA, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (output == INVALID_HANDLE_VALUE) return 65;
  record("begin", "\"subsystem\":\"windows\",\"console\":false,\"com\":false,\"window\":false");
  HANDLE self = nullptr; BOOL ok = OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY | READ_CONTROL, &self); DWORD error = ok ? ERROR_SUCCESS : GetLastError();
  step("Snapshot.OpenSelf", !!ok, error);
  if (!ok) { ok = OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &self); error = ok ? ERROR_SUCCESS : GetLastError(); step("Snapshot.OpenSelfQueryFallback", !!ok, error); }
  if (ok) { snapshot(self, "current"); CloseHandle(self); }
  else {
    // A denied token open is not an empty token. Preserve an explicit unknown
    // for each requested field even if no usable handle could be obtained.
    for (const char* field : {"TokenUser","TokenOwner","TokenPrimaryGroup","TokenGroups","TokenPrivileges","TokenIntegrityLevel","TokenMandatoryPolicy","TokenRestrictedSids","TokenElevationType","TokenDefaultDacl","ObjectOwner","ObjectDacl","ObjectMandatoryLabel"})
      record("field", "\"target\":\"current\",\"field\":" + quote(field) + ",\"result\":" + unknown(error));
  }
  int code = 0;
  if (args[1] == L"owner") {
    const auto token = reinterpret_cast<HANDLE>(static_cast<uintptr_t>(_wcstoui64(args[3].c_str(), nullptr, 10)));
    snapshot(token, "derived-before");
    if (args[4] == L"B") code = userAce(token,false) ? 0 : 2;
    else if (args[4] == L"C") code = userAce(token,true) ? 0 : 2;
    else if (args[4] == L"D") code = labelVariant(token);
    snapshot(token, "derived-effective");
  }
  chain(); record("end", "\"exitCode\":" + std::to_string(code)); CloseHandle(output); return code;
}
