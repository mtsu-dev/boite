import { AGENT_ONCE_KEPT_MS, AGENT_ROUTINE_CHECK_MAX, AGENT_ROUTINE_NAME_MAX, AGENT_ROUTINE_PROMPT_MAX, AGENT_ROUTINES_MAX, nextAgentOccurrence, spentAgentRoutine } from '@boite/contracts';
import type { AgentRoutine, AgentSchedule, RpcParams, Turn } from '@boite/contracts';
import type { Core } from '../core.ts';
import { refused } from '../errors.ts';
import { checkPrompt, runCheck, type CheckResult } from './checks.ts';
import { boolean, integer, object, text } from './validation.ts';

export function checkSchedule(value:AgentSchedule):AgentSchedule {
  object(value,'schedule');
  if(value.kind==='once')return{kind:'once',at:integer(value.at,'schedule.at',1,8_640_000_000_000_000)};
  if(value.kind==='interval')return{kind:'interval',everyMinutes:integer(value.everyMinutes,'everyMinutes',1,525600)};
  if(value.kind==='daily'||value.kind==='monthly'||value.kind==='yearly'){
    if(typeof value.time!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(value.time))throw refused('schedule.time: expected HH:mm');
    text(value.timezone,'schedule.timezone',100);
    try{new Intl.DateTimeFormat('en',{timeZone:value.timezone}).format();}catch{throw refused('schedule.timezone: expected an IANA timezone');}
    if(value.kind==='monthly')return{kind:'monthly',day:integer(value.day,'schedule.day',1,31),time:value.time,timezone:value.timezone};
    if(value.kind==='yearly'){
      const month=integer(value.month,'schedule.month',1,12),day=integer(value.day,'schedule.day',1,new Date(Date.UTC(2000,month,0)).getUTCDate());
      return{kind:'yearly',month,day,time:value.time,timezone:value.timezone};
    }
    const days=value.days===undefined?undefined:weekdays(value.days);
    return{kind:'daily',time:value.time,timezone:value.timezone,...(days&&days.length<7?{days}:{})};
  }
  throw refused('schedule.kind: expected once, interval, daily, monthly or yearly');
}
function weekdays(value:unknown):number[] {
  const bad=()=>refused('schedule.days: expected 1 to 7 different weekday numbers, 0 (Sunday) to 6');
  if(!Array.isArray(value)||value.length<1||value.length>7)throw bad();
  if(value.some(d=>!Number.isInteger(d)||d<0||d>6)||new Set(value).size!==value.length)throw bad();
  return[...value as number[]].sort((a,b)=>a-b);
}
/** Shared with the browser's preview and in-memory client. */
export const nextOccurrence = nextAgentOccurrence;

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** A schedule in a few words, for the agent's own context. */
export function scheduleText(schedule: AgentSchedule): string {
  if (schedule.kind === 'once') return `once at ${new Date(schedule.at).toISOString()}`;
  if (schedule.kind === 'interval') return `every ${schedule.everyMinutes} min`;
  if (schedule.kind === 'monthly') return `monthly on day ${schedule.day} at ${schedule.time} ${schedule.timezone}`;
  if (schedule.kind === 'yearly') return `yearly on ${schedule.month}-${schedule.day} at ${schedule.time} ${schedule.timezone}`;
  return `daily at ${schedule.time} ${schedule.timezone}${schedule.days ? ` on ${schedule.days.map(day => DAYS[day]).join(', ')}` : ''}`;
}

/** Occurrences in a row ending in `[quiet]` after which a routine without a check is told it could take one. */
export const QUIET_RUN_HINT = 3;
/** How often the scheduler looks for spent single-date routines to remove. */
const SWEEP_MS = 3_600_000;

/**
 * What a due occurrence of a routine without a check adds to its prompt once
 * its last `QUIET_RUN_HINT` ended in `[quiet]`: a check would have spared them.
 */
export function quietRunHint(routine: AgentRoutine, fullAccess: boolean): string {
  const command = `boite mochi schedule {"id":${JSON.stringify(routine.id)},"check":"<command>"}`;
  return `Boite: this routine ended in [quiet] its last ${routine.quietRun} times. If it only watches for something, give it a check: a command that prints only what should wake you and nothing when all is as before, so a time with nothing new costs no turn. `
    + (fullAccess ? `Add one with ${command}; the rest of the routine stays as it is.` : 'Your thread asks before commands, so ask the user to add one in the routine\'s editor.');
}

/** A routine's check as saved: trimmed, null when there is none. */
function checkOf(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return text(value, 'check', AGENT_ROUTINE_CHECK_MAX, true) || null;
}

/** The outcome a finished occurrence leaves on its routine. */
function outcomeOf(turn: Turn): NonNullable<AgentRoutine['lastOutcome']> {
  if (turn.status === 'done') return turn.quiet ? 'quiet' : 'done';
  return turn.status === 'stopped' ? 'stopped' : 'error';
}

/**
 * Routines: a due one becomes a `routine` turn on its agent's thread. An
 * occurrence still queued or running skips the next one, which only moves
 * `nextAt`; one that failed, stopped or had nothing to say never blocks. A
 * paused agent, a paused core or a spent daily budget skips the occurrence
 * (`lastOutcome: 'skipped'`); the agent's thread busy with something else
 * holds it until that turn ends. A routine with a check runs its command
 * first (`checks.ts`): nothing new moves the routine on with `nothing` and
 * starts no turn; something new, or a new failure, starts the turn with what
 * the command printed. What the agent last read is kept (`checkSeen`) once its
 * turn starts, so a restart, a busy thread or a spent budget loses no news.
 * A routine without a check whose last `QUIET_RUN_HINT` occurrences ended in
 * `[quiet]` says so in its next prompt, with the command to add one. A
 * single-date routine whose date passed is removed `AGENT_ONCE_KEPT_MS` later.
 */
export class AgentRoutines {
  readonly #core: Core;
  /** Routines whose check runs now. */
  readonly #checking = new Set<string>();
  /** What a check found for the occurrence due at `nextAt`, until that occurrence is settled. */
  readonly #found = new Map<string, { nextAt: number; command: string; result: CheckResult }>();
  constructor(core:Core) {
    this.#core = core;
  }
  get #r(){return this.#core.workforce.records;}

  save(params:RpcParams<'agents.routine.save'>):AgentRoutine {
    const v=params.value;object(v,'routine');const agent=this.#r.get('profile',text(v.agentId,'agentId',160));
    if(params.threadId!==undefined&&this.#core.workforce.agentOfThread(params.threadId)?.id!==agent.id)throw refused('routine: an agent schedules its own routines from its own thread',{field:'agentId'});
    const previous=params.id?this.#r.get('routine',params.id):null;
    if(previous&&previous.agentId!==agent.id)throw refused('agentId: a routine cannot change owner');
    if(!previous){
      const held=this.#r.list('routine').filter(r=>r.agentId===agent.id&&!spentAgentRoutine(r)).length;
      if(held>=AGENT_ROUTINES_MAX)throw refused(`routine: ${agent.name} already has ${held} routines, the most an agent may hold is ${AGENT_ROUTINES_MAX}; remove one before adding another`,{field:'agentId',count:held,max:AGENT_ROUTINES_MAX});
    }
    const schedule=checkSchedule(v.schedule),enabled=boolean(v.enabled,'enabled');
    const check=checkOf(v.check),kept=previous?.check??null;
    // The command runs without a permission card: an agent sets or changes one only while its own thread asks for none.
    if(params.threadId!==undefined&&check!==null&&check!==kept){
      const mode=this.#core.threads.require(params.threadId).permissionMode;
      if(mode!=='bypassPermissions'&&mode!=='yolo')throw refused(`check: ${agent.name} runs in a mode that asks before a command, so it cannot give a routine one that runs by itself; the owner adds it in the routine's editor, or gives ${agent.name} full access`,{field:'check',expected:'a thread with full access, or the owner'});
    }
    const changed=JSON.stringify(previous?.schedule)!==JSON.stringify(schedule);
    // A once routine that already ran is done: resuming it must not fire it again at its past date.
    // A new date re-arms it, even saved while paused, so that run no longer counts.
    const spent=schedule.kind==='once'&&!changed&&previous?.lastScheduledAt!=null;
    const nextAt=!enabled||spent?null:previous?.enabled&&!changed?previous.nextAt:schedule.kind==='once'?schedule.at:nextOccurrence(schedule,Date.now());
    const lastScheduledAt=schedule.kind==='once'&&changed?null:previous?.lastScheduledAt??null;
    const value:Omit<AgentRoutine,'id'|'revision'|'createdAt'|'updatedAt'>={agentId:agent.id,name:text(v.name,'name',AGENT_ROUTINE_NAME_MAX),prompt:text(v.prompt,'prompt',AGENT_ROUTINE_PROMPT_MAX),schedule,enabled,nextAt,lastTurnId:previous?.lastTurnId??null,lastScheduledAt,lastOutcome:previous?.lastOutcome??null,check,checkSeen:check!==null&&check===kept?previous?.checkSeen??null:null,quietRun:check===kept?previous?.quietRun??0:0};
    const result=params.id?this.#r.update('routine',params.id,integer(params.expectedRevision,'expectedRevision',1,Number.MAX_SAFE_INTEGER),value):this.#r.create('routine',value);
    this.#core.workforce.changed();return result;
  }

  remove(params:RpcParams<'agents.routine.remove'>):{removed:true} {
    const routine=this.#r.get('routine',text(params.routineId,'routineId',160));
    if(params.threadId!==undefined&&this.#core.workforce.agentOfThread(params.threadId)?.id!==routine.agentId)throw refused('routine: an agent removes only its own routines',{field:'routineId'});
    this.#r.remove('routine',routine.id);
    this.#found.delete(routine.id);
    this.#core.workforce.changed();
    return {removed:true};
  }

  /** The owner's Run now: the occurrence starts at once, whatever the pause or the budget, on an idle thread. */
  run(params:RpcParams<'agents.routine.run'>):{turnId:string} {
    const routine=this.#r.get('routine',text(params.routineId,'routineId',160));
    const agent=this.#r.get('profile',routine.agentId);
    if(agent.status==='archived')throw refused(`routine: ${agent.name} is archived`,{field:'routineId'});
    const requestId=`run-${text(params.requestId,'requestId',100)}`;
    // A retried Run now answers the turn it started, whatever that turn is doing now.
    const prior=this.#core.journal.turnRequest(this.#core.workforce.open(agent.id).threadId,requestId);
    if(prior)return {turnId:prior.turn_id};
    const turn=this.#core.agentRuntime.start(agent,{kind:'routine',label:`Routine · ${routine.name}`,prompt:routine.prompt,requestId});
    this.#occurred(routine,turn.id,false);
    return {turnId:turn.id};
  }

  /**
   * Writes an occurrence that started, or one that was skipped, and moves the routine to its next time.
   * `seen` is the print of the check output the started turn carries.
   */
  #occurred(routine:AgentRoutine,turnId:string|null,due:boolean,seen?:string|null):void {
    const now=Date.now();
    const current=this.#r.get('routine',routine.id);
    const once=current.schedule.kind==='once';
    // Run now leaves the schedule as it was; a due occurrence moves it on.
    const next=due?{nextAt:current.enabled&&!once?nextOccurrence(current.schedule,now):null,enabled:current.enabled&&!once}:{};
    this.#r.update('routine',current.id,current.revision,{...current,...next,lastScheduledAt:now,
      ...(turnId===null?{lastOutcome:'skipped' as const}:{lastTurnId:turnId,lastOutcome:null,...(seen===undefined?{}:{checkSeen:seen})})});
    this.#core.workforce.changed();
  }

  /** A due occurrence whose check had nothing new: no turn, the routine moves on. Empty output forgets what was seen, so the same news later counts again. */
  #nothing(routine:AgentRoutine,print:string|null):void {
    const now=Date.now();
    const current=this.#r.get('routine',routine.id);
    const once=current.schedule.kind==='once';
    this.#r.update('routine',current.id,current.revision,{...current,nextAt:current.enabled&&!once?nextOccurrence(current.schedule,now):null,enabled:current.enabled&&!once,
      lastScheduledAt:now,lastOutcome:'nothing',checkSeen:print});
    this.#core.workforce.changed();
  }

  /** Starts the check of a due occurrence; its result waits in `#found` for the next tick. */
  #check(agentId:string,routine:AgentRoutine,command:string):void {
    const nextAt=routine.nextAt!;
    this.#checking.add(routine.id);
    void (async():Promise<CheckResult>=>{
      const thread=this.#core.threads.require(this.#core.workforce.open(agentId).threadId);
      return runCheck(this.#core,thread,command);
    })().catch((error):CheckResult=>{
      const text=`The check could not start: ${error instanceof Error?error.message:String(error)}`;
      return{text,failed:true,print:text};
    }).then(result=>{
      this.#checking.delete(routine.id);
      if(this.#core.stopping||!this.#r.find('routine',routine.id))return;
      this.#found.set(routine.id,{nextAt,command,result});
      this.#next=null;
    });
  }

  /** A due occurrence whose previous one still runs only moves on. */
  #advance(routine:AgentRoutine):void {
    const now=Date.now();
    const once=routine.schedule.kind==='once';
    this.#r.update('routine',routine.id,routine.revision,{...routine,nextAt:routine.enabled&&!once?nextOccurrence(routine.schedule,now):null,enabled:routine.enabled&&!once});
    this.#core.workforce.changed();
  }

  /** Removes the single-date routines spent more than `AGENT_ONCE_KEPT_MS` ago, and says when the next one is due to go. */
  #sweep(now:number):void {
    let removed=false,next=now+SWEEP_MS;
    for(const routine of this.#r.list('routine')){
      if(!spentAgentRoutine(routine))continue;
      const at=routine.lastScheduledAt!+AGENT_ONCE_KEPT_MS;
      if(at>now){next=Math.min(next,at);continue;}
      this.#r.remove('routine',routine.id);this.#found.delete(routine.id);removed=true;
    }
    // One spent after this sweep goes a week later at the earliest, past the next sweep.
    this.#sweepAt=next;
    if(removed)this.#core.workforce.changed();
  }

  /** The routine whose last occurrence this turn was, with its outcome. */
  finished(turn:Turn):void {
    if(turn.execution?.operation!=='routine')return;
    const routine=this.#r.list('routine').find(r=>r.lastTurnId===turn.id);
    if(!routine)return;
    const outcome=outcomeOf(turn);
    // Only an answer or another [quiet] moves the run; a failed or stopped turn says nothing about the routine.
    const quietRun=outcome==='quiet'?(routine.quietRun??0)+1:outcome==='done'?0:routine.quietRun??0;
    this.#r.update('routine',routine.id,routine.revision,{...routine,lastOutcome:outcome,quietRun});
    this.#core.workforce.changed();
  }

  /**
   * The earliest future `nextAt` as of a record-write count: until the count
   * moves or that time comes, a tick reads nothing. A due routine held by a busy
   * thread keeps the next tick reading.
   */
  #next:{writes:number;at:number|null}|null=null;
  /** When the scheduler next looks for spent single-date routines. */
  #sweepAt=0;
  tick(now=Date.now()):void {
    if(this.#core.stopping)return;
    if(now>=this.#sweepAt)this.#sweep(now);
    const writes=this.#r.writes;
    if(this.#next&&this.#next.writes===writes&&(this.#next.at===null||this.#next.at>now))return;
    let at:number|null=null,held=false;
    const paused=this.#core.workforce.limits().paused;
    for(const routine of this.#r.list('routine')){
      if(!routine.enabled||routine.nextAt===null)continue;
      if(routine.nextAt>now){at=at===null?routine.nextAt:Math.min(at,routine.nextAt);continue;}
      const agent=this.#r.find('profile',routine.agentId);
      if(!agent||agent.status==='archived')continue;
      const last=routine.lastTurnId?this.#core.journal.getTurn(routine.lastTurnId):null;
      if(last&&(last.status==='queued'||last.status==='running')){this.#advance(routine);continue;}
      if(paused||agent.status==='paused'){this.#occurred(routine,null,true);continue;}
      let prompt=routine.prompt,seen:string|null|undefined;
      const command=routine.check?.trim();
      if(command){
        const found=this.#found.get(routine.id);
        if(!found||found.nextAt!==routine.nextAt||found.command!==command){
          this.#found.delete(routine.id);
          if(!this.#checking.has(routine.id))this.#check(agent.id,routine,command);
          held=true;continue;
        }
        const {result}=found;
        if(result.print===null||result.print===(routine.checkSeen??null)){this.#found.delete(routine.id);this.#nothing(routine,result.print);continue;}
        prompt=checkPrompt(routine.prompt,command,result);seen=result.print;
      }else if(routine.schedule.kind!=='once'&&(routine.quietRun??0)>=QUIET_RUN_HINT){
        const mode=this.#core.journal.getThread(this.#core.workforce.open(agent.id).threadId)?.permissionMode;
        prompt=`${prompt}\n\n${quietRunHint(routine,mode==='bypassPermissions'||mode==='yolo')}`;
      }
      const attempt=this.#core.agentRuntime.attempt(agent,{kind:'routine',label:`Routine · ${routine.name}`,prompt,requestId:`due-${routine.id}-${routine.nextAt}`});
      if(attempt.held==='busy'){held=true;continue;}
      this.#found.delete(routine.id);
      this.#occurred(routine,attempt.turn?.id??null,true,attempt.turn?seen:undefined);
    }
    // A skipped or started occurrence moved its own `nextAt`: the earliest is read again after them.
    if(!held)for(const routine of this.#r.list('routine'))if(routine.enabled&&routine.nextAt!==null&&routine.nextAt>now)at=at===null?routine.nextAt:Math.min(at,routine.nextAt);
    this.#next=held?null:{writes:this.#r.writes,at};
  }
}
