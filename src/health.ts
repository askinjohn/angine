import { agentName, shortText } from './model.js';
import type { AgentProfile, ReporterConnection, ReportingHealth } from './types.js';
import { connectionStatus, protocolVersion, serverVersion } from './reporting.js';
export { protocolVersion, serverVersion } from './reporting.js';
export class ReporterRegistry {
  private reporters = new Map<string, ReporterConnection>();
  constructor(private profiles: () => Record<string, AgentProfile>, private clock = () => Date.now(), private lastKnownReport: (reporterId:string) => string | undefined = () => undefined) {}
  ping(input: Record<string, unknown>): ReporterConnection {
    const id = shortText(input.reporterId,160,'Reporter ID',true);
    const agent = agentName(input.agent);
    const profileKey = shortText(input.profileKey,160,'Profile key');
    const version = shortText(input.version,80,'Reporter version');
    const sourceSessionId = shortText(input.sourceSessionId,160,'Source session ID');
    const previous = this.reporters.get(id);
    if (previous && previous.agent !== agent) throw new Error('Reporter identity mismatch');
    if (!previous && this.reporters.size >= 500) {
      const oldest = [...this.reporters.values()].filter(r => connectionStatus(r,this.clock()) === 'disconnected').sort((a,b) => a.lastSeenAt.localeCompare(b.lastSeenAt))[0];
      if (oldest) this.reporters.delete(oldest.id);
      else throw new Error('Too many connected reporters');
    }
    const profile = Object.values(this.profiles()).find(p => p.agent === agent && (profileKey ? p.key === profileKey : p.isDefault));
    const timestamp = new Date(this.clock()).toISOString();
    const connection: ReporterConnection = { id,agent,version:version || previous?.version,profileKey,
      profileId:profile?.id,sourceSessionId:sourceSessionId || previous?.sourceSessionId,
      startedAt:previous?.startedAt || timestamp,lastSeenAt:timestamp,
      lastReportAt:previous?.lastReportAt || (!previous ? this.lastKnownReport(id) : undefined),successfulReports:previous?.successfulReports || 0,failedReports:previous?.failedReports || 0,
      issue:profileKey && !profile ? 'profile_missing' : input.protocolVersion !== protocolVersion ? 'reporter_outdated' : previous?.issue === 'report_rejected' ? 'report_rejected' : undefined };
    this.reporters.set(id,connection);
    return structuredClone(connection);
  }
  report(id: unknown, successful: boolean): void {
    if (typeof id !== 'string') return;
    const reporter = this.reporters.get(id);
    if (!reporter) return;
    if (successful) { reporter.successfulReports++; reporter.lastReportAt = new Date(this.clock()).toISOString(); if(reporter.issue === 'report_rejected') reporter.issue = undefined; }
    else { reporter.failedReports++; if(!reporter.issue) reporter.issue = 'report_rejected'; }
  }
  close(id: unknown): void {
    if (typeof id === 'string' && this.reporters.has(id)) this.reporters.get(id)!.closedAt = new Date(this.clock()).toISOString();
  }
  view(): ReportingHealth {
    return {serverVersion,protocolVersion,checkedAt:new Date(this.clock()).toISOString(),reporters:structuredClone([...this.reporters.values()])};
  }
}
