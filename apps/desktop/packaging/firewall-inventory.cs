using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Management.Automation;
using System.Security.Cryptography;
using System.Text;
using System.Web.Script.Serialization;

// The values admitted here are the scalar/array shapes returned by INetFwRule.
// Unknown shapes fail instead of silently losing a compared configuration field.
public static class FirewallInventoryBulk {
  static readonly string[] Fields = {"Description","ApplicationName","ServiceName","Protocol","LocalPorts","RemotePorts","LocalAddresses","RemoteAddresses","IcmpTypesAndCodes","Direction","Interfaces","InterfaceTypes","Enabled","Grouping","Profiles","EdgeTraversal","Action","LocalAppPackageId","LocalUserOwner","LocalUserAuthorizedList","RemoteUserAuthorizedList","RemoteMachineAuthorizedList","SecureFlags"};
  static object Unwrap(object value) { while(value is PSObject) value=((PSObject)value).BaseObject; return value; }
  static object JsonValue(object value) {
    value=Unwrap(value);
    if(value==null||value is string||value is bool||value is int||value is long||value is uint||value is short||value is byte) return value;
    var sequence=value as IEnumerable;
    if(sequence!=null) {var values=new List<object>();foreach(object item in sequence) values.Add(JsonValue(item));return values.ToArray();}
    throw new InvalidOperationException("FIREWALL_FIELD_TYPE_REFUSED");
  }
  public static object[] Normalize(object[] input,bool machineWritable,Func<string,bool> reference) {
    var serializer=new JavaScriptSerializer {MaxJsonLength=int.MaxValue};
    var hashes=new Dictionary<string,string>(StringComparer.Ordinal);
    var references=new Dictionary<string,bool>(StringComparer.Ordinal);
    using(var sha=SHA256.Create()) {
      Func<object,string> digest=value=> {
        var raw=JsonValue(value);
        // ConvertTo-Json emits no pipeline value for null in Windows PS 5.1;
        // the legacy Digest(string) consequently hashes an empty string.
        string json=raw==null?"":serializer.Serialize(raw),hash;
        if(!hashes.TryGetValue(json,out hash)) {hash=BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(json))).Replace("-","").ToLowerInvariant();hashes.Add(json,hash);}
        return hash;
      };
      Func<object,bool> app=null;
      app=value=> {
        value=Unwrap(value);
        var sequence=value as IEnumerable;
        if(sequence!=null&&!(value is string)) {foreach(var child in sequence) if(app(child))return true;return false;}
        string text=value==null?"":Convert.ToString(value,CultureInfo.CurrentCulture);bool matched;
        if(!references.TryGetValue(text,out matched)){matched=reference(text);references.Add(text,matched);}
        return matched;
      };
      var groups=new Dictionary<string,List<IDictionary>>(StringComparer.CurrentCultureIgnoreCase);
      foreach(object item in input) {
        var row=Unwrap(item) as IDictionary;if(row==null)throw new InvalidOperationException("FIREWALL_ROW_REFUSED");
        string name=Convert.ToString(row["name"]);var values=Unwrap(row["values"]) as IDictionary;
        if(string.IsNullOrEmpty(name)||values==null||values.Count!=Fields.Length||Fields.Any(field=>!values.Contains(field)))throw new InvalidOperationException("FIREWALL_FIELD_SET_REFUSED");
        var fields=new Hashtable();bool attributed=app(name);
        foreach(string field in Fields){fields[field]=digest(values[field]);attributed=attributed||app(field)||app(values[field]);}
        bool strict=machineWritable||!string.IsNullOrEmpty(Convert.ToString(values["LocalUserOwner"]));
        var normalized=new Hashtable {{"name",name},{"fields",fields},{"strict",strict},{"appReference",attributed}};
        List<IDictionary> group;if(!groups.TryGetValue(name,out group)){group=new List<IDictionary>();groups.Add(name,group);}group.Add(normalized);
      }
      var result=new List<object>();
      foreach(var group in groups.Values.OrderBy(rows=>(string)rows[0]["name"],StringComparer.CurrentCultureIgnoreCase)) {
        var fields=new Hashtable();foreach(string field in Fields)fields[field]=digest(group.Select(row=>(string)((IDictionary)row["fields"])[field]).OrderBy(hash=>hash,StringComparer.CurrentCultureIgnoreCase).ToArray());
        result.Add(new Hashtable {{"name",group[0]["name"]},{"count",group.Count},{"strict",group.Any(row=>(bool)row["strict"])},{"appReference",group.Any(row=>(bool)row["appReference"])},{"fields",fields}});
      }
      return result.ToArray();
    }
  }
}
