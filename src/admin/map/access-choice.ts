/** The owner's access-point choice and its request field (pure). */

export type AccessChoice =
  { kind: 'unset' } | { kind: 'keep' } | { kind: 'none' } | { kind: 'node'; nodeId: number; note: string };

/** The request field for a choice: undefined = do not send, null = clear, object = set. */
export function accessPointBody(choice: AccessChoice): { nodeId: number; note?: string } | null | undefined {
  if (choice.kind === 'node') {
    const note = choice.note.trim();
    return note ? { nodeId: choice.nodeId, note } : { nodeId: choice.nodeId };
  }
  if (choice.kind === 'none') return null;
  return undefined;
}
