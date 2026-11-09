<script lang="ts">
  import { Target, Users } from '@lucide/svelte';
  import type { AgentProfile } from '@boite/contracts';
  import type { AgentMood } from '../../lib/agents.svelte';
  import { isAgentPicture } from '@boite/contracts';
  import { avatarText, robotColor, robotOf, seededRobot, tintOf } from '../../lib/robots';
  import { agentPictures } from '../../lib/agent-pictures.svelte';
  import { threadTone } from '../../lib/thread-state';
  import { avatarLit, moodFacts } from '../../lib/avatar-lit';
  import StatusMark from '../StatusMark.svelte';
  import Deferred from '../Deferred.svelte';
  import { parts } from '../../lib/deferred-parts';
  import type { RobotState } from './RobotFace.svelte';

  /**
   * An agent's picture: its robot, the image the owner imported, or the emoji
   * or letters it chose instead, on a disc. A group stacks two of its members,
   * a team of three or more shows four in a 2×2 grid, a mission shows a
   * target. An imported image leaves the disc empty while it
   * loads, and draws the robot its id picks when no machine holds it.
   *
   * `ring` draws a ring around the disc that says the agent's `mood`: a still
   * accent ring while it works in a list, as a thread row's mark (colour is kept
   * for asks and failures), an arc of the accent turning where
   * it is the open bot (`live`), the one place the eye follows its work; the waiting colour pulsing while it
   * needs the user, danger after a failure, a full accent ring over answers not
   * read, a dashed one while it is queued or asleep, a hairline in the
   * robot's own colour at rest. The robot's face moves with it. Without a ring
   * the corner dot says whether it works or waits, for a picture too small to
   * read a face, and for text avatars.
   *
   * `squircle` rounds the corners instead of drawing a disc, about a third of
   * the side: the selected bot's picture in its column and on its desk.
   *
   * The picture is grey until `lit` (`lib/avatar-lit.ts`: the open bot, one
   * that waits on the owner, failed or has news, which its own mood also
   * says) or the pointer is over the control that holds it.
   */
  let { kind, id, name, avatar = '', members = [], status = 'idle', mood, size = 40, ring = false, squircle = false, live = false, lit = false }: {
    kind: 'profile' | 'group' | 'team' | 'mission';
    id: string;
    name: string;
    avatar?: string;
    members?: Pick<AgentProfile, 'id' | 'name' | 'avatar'>[];
    /** `running`, `waiting` or `idle`: what the corner dot and the face show without a mood. */
    status?: string;
    mood?: AgentMood;
    size?: number;
    ring?: boolean;
    squircle?: boolean;
    live?: boolean;
    lit?: boolean;
  } = $props();

  const grouped = $derived(kind === 'group' || kind === 'team');
  /** The members drawn: a group stacks two, a team of three or more sits in a 2×2 grid. */
  const shown = $derived(kind === 'team' && members.length > 2 ? members.slice(0, 4) : members.slice(0, 2));
  const tiled = $derived(shown.length > 2);
  /** The imported image, once loaded: null for a robot or text avatar. */
  const image = $derived(kind === 'profile' && isAgentPicture(avatar) ? agentPictures.url(avatar) : null);
  const robot = $derived(kind === 'profile' ? portraitRobot(id, avatar) : null);
  $effect(() => {
    if (kind === 'profile') void agentPictures.load(avatar);
    else for (const member of shown) void agentPictures.load(member.avatar);
  });
  /** The robot to draw: none for an imported image, unless no machine holds it. */
  function portraitRobot(seed: string, own: string) {
    if (!isAgentPicture(own)) return robotOf(seed, own);
    return agentPictures.missing[own.trim()] !== undefined && !agentPictures.url(own) ? seededRobot(seed) : null;
  }
  const standing = $derived<AgentMood>(mood ?? (status === 'running' ? 'working' : status === 'waiting' ? 'waiting' : 'idle'));
  const colored = $derived(lit || avatarLit(moodFacts(standing)));
  const face = $derived<RobotState>(size < 24 ? 'still' : standing === 'working' || standing === 'waiting' || standing === 'error' || standing === 'asleep' ? standing : 'idle');
  /** The ring's resting colour: the robot's body, else the disc's tint. */
  const ringTint = $derived(robot ? robotColor(robot) : tintOf(id));
  const pictured = $derived(kind === 'profile' && isAgentPicture(avatar) && !robot);
  const radius = $derived(size / 2 + 2.5);
</script>

{#snippet picture(member: Pick<AgentProfile, 'id' | 'name' | 'avatar'>, state: RobotState)}
  {@const own = portraitRobot(member.id, member.avatar)}
  {@const image = isAgentPicture(member.avatar) ? agentPictures.url(member.avatar) : null}
  {#if image}<img class="agent-picture" src={image} alt="" draggable="false" />{:else if own}<Deferred part={parts.RobotFace} quiet>{#snippet children(RobotFace)}<RobotFace robot={own} {state} />{/snippet}</Deferred>{:else if !isAgentPicture(member.avatar)}<span class="ui-label">{avatarText(member.name, member.avatar)}</span>{/if}
{/snippet}

<span class="agent-avatar" class:robot={!!robot} class:pictured class:squircle style:--avatar-radius={squircle ? `${Math.round(size * 0.32)}px` : null} data-kind={kind} data-ring={ring ? standing : null} data-live={live || null} data-lit={colored || null} style:--size="{size}px" style:--tint={kind === 'mission' ? null : tintOf(id)} style:--ring-tint={ring ? ringTint : null} aria-hidden="true">
  {#if ring}
    <svg class="avatar-ring" aria-hidden="true">
      <circle class="track" cx="50%" cy="50%" r={radius} pathLength="100" />
      {#if standing === 'working' && live}<circle class="arc" cx="50%" cy="50%" r={radius} pathLength="100" />{/if}
    </svg>
  {/if}
  {#if grouped && members.length >= 2}
    {#each shown as member, slot (member.id)}
      <span class="agent-avatar-stack" class:tile={tiled} class:robot={!!portraitRobot(member.id, member.avatar) || !!agentPictures.url(member.avatar)} data-slot={slot} data-of={shown.length} style:--tint={tintOf(member.id)}>{@render picture(member, 'still')}</span>
    {/each}
  {:else if grouped}
    <Users size={Math.round(size * 0.45)} strokeWidth={1.75} />
  {:else if kind === 'mission'}
    <Target size={Math.round(size * 0.45)} strokeWidth={1.75} />
  {:else if image}
    <img class="agent-picture" src={image} alt="" draggable="false" />
  {:else if pictured}
    <!-- The imported image is on its way: the tinted disc meanwhile. -->
  {:else if robot}
    {@const own = robot}
    <Deferred part={parts.RobotFace} quiet>{#snippet children(RobotFace)}<RobotFace robot={own} state={face} />{/snippet}</Deferred>
  {:else}
    <span class="ui-label">{avatarText(name, avatar)}</span>
  {/if}
  {#if !ring && (status === 'running' || status === 'waiting')}<StatusMark {...threadTone(status)} corner />{/if}
</span>

<style>
  /* Initials on a disc tinted by the id, a robot cropped to the same disc, two members stacked for a group. */
  .agent-avatar { --size: 40px; --tint: var(--series-other); position: relative; width: var(--size); height: var(--size); flex: none; display: grid; place-items: center; border-radius: 50%; background: color-mix(in srgb, var(--tint) 28%, var(--color-surface-2)); color: color-mix(in srgb, var(--tint) 40%, var(--color-foreground)); font-size: calc(var(--size) * 0.38); font-weight: 600; line-height: 1; user-select: none; }
  .agent-avatar.robot, .agent-avatar:has(.agent-avatar-stack) { background: none; }
  /* Grey at rest, its colours when lit or under the pointer (the control that holds it, or the keyboard's row). */
  .agent-avatar { filter: var(--avatar-rest); transition: filter var(--dur-2) var(--ease-out-quint); }
  .agent-avatar[data-lit] { filter: none; }
  @media (hover: hover) {
    :global(:is(button, a, label, [role='button'], [role='option'], [role='menuitem'], [role='link']):hover:not(:disabled)) .agent-avatar { filter: none; }
  }
  :global(:is(button, a, [role='button'], [role='link']):focus-visible) .agent-avatar, :global([role='option'][aria-selected='true']) .agent-avatar { filter: none; }
  @media (prefers-reduced-motion: reduce) { .agent-avatar { transition: none; } }
  :global(html[data-motion='reduced']) .agent-avatar { transition: none; }
  .agent-avatar :global(svg.robot) { border-radius: 50%; overflow: hidden; transition: opacity var(--dur-3) var(--ease-out-quint); }
  /* An imported image fills the disc, cropped to it, whatever its shape. */
  .agent-picture { width: 100%; height: 100%; border-radius: 50%; object-fit: cover; display: block; transition: opacity var(--dur-3) var(--ease-out-quint); }
  /* A squircle crops the robot or the picture to its corners, on the raised fill a robot leaves around its face. */
  .agent-avatar.squircle { border-radius: var(--avatar-radius); overflow: hidden; }
  .agent-avatar.squircle.robot { background: var(--color-surface-3); }
  .agent-avatar.squircle :global(svg.robot), .agent-avatar.squircle .agent-picture { border-radius: var(--avatar-radius); }
  .agent-avatar[data-kind='mission'] { border-radius: var(--radius-md); background: var(--color-surface-3); color: var(--color-muted-foreground); }
  .agent-avatar-stack { position: absolute; width: 62%; height: 62%; display: grid; place-items: center; border-radius: 50%; background: color-mix(in srgb, var(--tint) 28%, var(--color-surface-2)); color: color-mix(in srgb, var(--tint) 40%, var(--color-foreground)); font-size: calc(var(--size) * 0.26); box-shadow: 0 0 0 2px var(--ring, var(--color-surface)); }
  .agent-avatar-stack.robot { background: none; }
  .agent-avatar-stack[data-slot='0'] { top: 0; left: 0; }
  .agent-avatar-stack[data-slot='1'] { right: 0; bottom: 0; }
  /* A team of three or four: one quarter each, the third centred under the first two when it is the last. */
  .agent-avatar-stack.tile { width: 48%; height: 48%; font-size: calc(var(--size) * 0.2); box-shadow: none; }
  .agent-avatar-stack.tile[data-slot='1'] { top: 0; right: 0; bottom: auto; }
  .agent-avatar-stack.tile[data-slot='2'] { bottom: 0; left: 0; }
  .agent-avatar-stack.tile[data-slot='2'][data-of='3'] { left: 26%; }
  .agent-avatar-stack.tile[data-slot='3'] { right: 0; bottom: 0; }
  /* The status mark only while it works or waits, at most a third of a small picture. */
  .agent-avatar { --mark-size: clamp(6px, calc(var(--size) * 0.24), 9px); }

  /*
   * The ring, just outside the disc. It shares the portrait's viewport so CSS
   * border snapping cannot shift or thin it at fractional zoom. Hue says the
   * state; only rest wears the robot's own colour.
   */
  .avatar-ring { position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none; }
  /* Every track keeps the 1.5 px hairline: a whole-pixel width snaps off-centre at fractional zoom (tests/e2e/avatar-rings.test.ts). */
  .avatar-ring circle { fill: none; stroke-width: 1.5px; transition: stroke var(--dur-3) var(--ease-out-quint); }
  .track { stroke: color-mix(in srgb, var(--ring-tint) 50%, transparent); }
  /* At work in a list: a still accent ring, the thread rows' work mark (StatusMark.svelte). The open bot's turns an accent spinner around a quiet track. */
  [data-ring='working'] .track { stroke: var(--color-accent); }
  [data-ring='working'][data-live] .track { stroke: var(--color-edge); }
  .avatar-ring .arc { stroke: var(--color-accent); stroke-linecap: round; stroke-width: 2.5px; stroke-dasharray: 30 70; transform-box: fill-box; transform-origin: center; animation: spin 1.2s steps(72) infinite var(--loops); }
  [data-ring='queued'] .track { stroke: var(--color-muted-foreground); stroke-dasharray: 4 6; opacity: 0.7; }
  /* Needs the user: the waiting colour, pulsing. */
  [data-ring='waiting'] .track { stroke: var(--color-live); animation: pulse 1.6s var(--loop-ease-in-out-48) infinite var(--loops); }
  [data-ring='error'] .track { stroke: var(--color-danger); }
  [data-ring='unread'] .track { stroke: var(--color-foreground); }
  [data-ring='asleep'] .track { stroke: var(--color-edge); stroke-dasharray: 2 5; stroke-linecap: round; }
  [data-ring='asleep'] :is(:global(svg.robot), .agent-picture) { opacity: 0.7; }
  @media (prefers-reduced-motion: reduce) { .agent-avatar .avatar-ring :is(.arc, .track) { animation: none; } }
  :global(html[data-motion='reduced']) .agent-avatar .avatar-ring :is(.arc, .track) { animation: none; }
</style>
