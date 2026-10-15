import { useState } from 'preact/hooks';
import type { Mission, Project } from '../../src/types';
import { projectColor } from '../../src/colors';

export function ColorControl({project,mission,mutate}:{project:Project;mission?:Mission;mutate:(operation:string,input:unknown)=>Promise<boolean>}) {
  const [saving,setSaving] = useState(false);
  const target = mission ? {missionId:mission.id} : {projectId:project.id};
  const save = async(color:string|null) => {setSaving(true);try {await mutate('color',{...target,color});} finally {setSaving(false);}};
  const ownColor = mission ? mission.color : project.color;
  return <div class="color-control"><label><span>{mission ? 'Mission color' : 'Project color'}</span><input type="color" aria-label={mission ? 'Choose mission color override' : 'Choose project color'} value={ownColor || projectColor(project)} disabled={saving} onChange={e=>void save(e.currentTarget.value)} /></label><p>{mission ? ownColor ? 'Custom color for this mission and its tasks.' : 'Inherits the project color.' : 'Used by all missions and tasks without an override.'}</p>{ownColor && <button class="text-button" disabled={saving} onClick={()=>void save(null)}>{mission ? 'Use project color' : 'Reset to automatic'}</button>}{saving && <span role="status">Saving…</span>}</div>;
}
