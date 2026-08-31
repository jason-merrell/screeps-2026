import { readFile, writeFile } from "node:fs/promises";

const RESULT_STATUSES = new Set(["passed", "failed", "infrastructure-failed"]);
const OUTPUT_TAIL_LIMIT = 64 * 1024;

function outputTail(value) {
  if (typeof value !== "string" || value.length === 0) return null;
  return value.slice(-OUTPUT_TAIL_LIMIT);
}

function emitChildOutput(stdout, stderr) {
  if (typeof stdout === "string" && stdout.trim()) process.stdout.write(stdout);
  if (typeof stderr === "string" && stderr.trim()) process.stderr.write(stderr);
}

function describeChildFailure(error) {
  return {
    message: error instanceof Error ? error.message : String(error),
    exitCode: typeof error?.code === "number" ? error.code : null,
    signal: typeof error?.signal === "string" ? error.signal : null,
    killed: error?.killed === true,
    stdoutTail: outputTail(error?.stdout),
    stderrTail: outputTail(error?.stderr),
  };
}

export async function runDiagnosticChild({
  execFileAsync,
  file,
  args,
  options,
  resultPath,
  resultName,
}) {
  let runnerFailure = null;
  try {
    const { stdout, stderr } = await execFileAsync(file, args, options);
    emitChildOutput(stdout, stderr);
  } catch (error) {
    emitChildOutput(error?.stdout, error?.stderr);
    runnerFailure = describeChildFailure(error);
  }

  let result;
  try {
    result = JSON.parse(await readFile(resultPath, "utf8"));
  } catch (error) {
    result = {
      name: resultName,
      status: "infrastructure-failed",
      error: `Scenario process did not write a readable result: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (
    !result ||
    typeof result !== "object" ||
    !RESULT_STATUSES.has(result.status)
  ) {
    result = {
      name: resultName,
      status: "infrastructure-failed",
      error: `Scenario process wrote an invalid status '${result?.status ?? "missing"}'`,
      invalidResult: result ?? null,
    };
  } else if (runnerFailure && result.status === "passed") {
    result = {
      ...result,
      status: "infrastructure-failed",
      error: `Scenario process exited unsuccessfully after reporting a pass: ${runnerFailure.message}`,
    };
  }

  if (runnerFailure) result.runnerFailure = runnerFailure;
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return result;
}
