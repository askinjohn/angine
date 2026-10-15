/** Stable visual marker; status is always communicated separately with text. */
export function missionColor(id: string): string {
  let hash = 2166136261;
  for (const character of id) hash = Math.imul(hash ^ character.charCodeAt(0),16777619) >>> 0;
  return `hsl(${hash % 3600 / 10} ${45 + (hash >>> 12) % 20}% 46%)`;
}
export const missionBorder = (id: string) => ({borderInlineStart:`3px solid ${missionColor(id)}`});
