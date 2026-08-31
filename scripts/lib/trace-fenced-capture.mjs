/**
 * Capture one payload inside a completed before/after trace bracket.
 * The first trace read must settle before any payload request starts; the
 * second trace read starts only after every payload request has settled.
 */
export async function traceFencedCapture(readTrace, readPayload) {
  const initialTrace = await readTrace();
  const payload = await readPayload();
  const finalTrace = await readTrace();
  return { initialTrace, payload, finalTrace };
}
