import { Console } from 'node:console';
import process from 'node:process';
const console = new Console(process.stdout, process.stderr);
// Reporter callbacks run in the coordinator even while a worker/test is stuck.
export default class SuiteProgress {
  onTestModuleQueued(module) {
    console.log('SUITE_MODULE_QUEUED', module.moduleId);
  }
  onTestModuleStart(module) {
    console.log('SUITE_MODULE_START', module.moduleId);
  }
  onTestCaseReady(test) {
    console.log('SUITE_TEST_START', test.fullName);
  }
  onTestCaseResult(test) {
    console.log('SUITE_TEST_END', test.fullName, test.result().state);
  }
  onHookStart(context) {
    console.log('SUITE_HOOK_START', context.name, context.entity.fullName);
  }
  onHookEnd(context) {
    console.log('SUITE_HOOK_END', context.name, context.entity.fullName);
  }
}
