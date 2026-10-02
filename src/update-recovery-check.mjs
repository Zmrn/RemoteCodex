// A launch command can focus an old window that is still exiting. A zero exit
// code is not evidence that the service has restarted.
export function confirmRestart(actual, { version, instanceId, application }) {
  if (!actual || actual.version !== version || actual.instanceId === instanceId ||
      typeof actual.instanceId !== 'string' || !actual.instanceId ||
      actual.application !== application || !Number.isInteger(actual.pid) || actual.pid <= 0)
    throw Error('启动命令已返回，但未确认新的桥接实例；接入服务尚未恢复');
  return actual;
}
