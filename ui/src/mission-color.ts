import type { State } from '../../src/types';
import { effectiveColor } from '../../src/colors';
export const workBorder = (state: State | null, projectId: string, missionId?: string) =>
  state ? {borderInlineStart:`3px solid ${effectiveColor(state,projectId,missionId)}`} : undefined;
