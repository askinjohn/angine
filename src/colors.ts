import type { Project, State } from './types.js';

export function defaultProjectColor(id: string): string {
  let hash = 2166136261;
  for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0),16777619) >>> 0;
  return '#' + [0,8,16].map(shift => (60 + ((hash >>> shift) & 255) % 111).toString(16).padStart(2,'0')).join('');
}
export const projectColor = (project: Pick<Project,'id'|'color'>) => project.color || defaultProjectColor(project.id);
export const effectiveColor = (state: Pick<State,'projects'|'missions'>, projectId: string, missionId?: string): string =>
  (missionId && state.missions[missionId]?.color) || projectColor(state.projects[projectId] || {id:projectId});
