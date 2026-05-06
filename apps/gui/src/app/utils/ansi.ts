const ANSI_ESCAPE_PATTERN = /\u001B(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*(?:\u0007|\u001B\\)|[PX^_][\s\S]*?\u001B\\|[@-_])/g;

export function stripAnsi(value: string) {
  return value.replace(ANSI_ESCAPE_PATTERN, "");
}
