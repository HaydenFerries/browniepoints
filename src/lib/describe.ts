import type { Activity, UUID } from './types';

/** Feed / toast wording for an activity row, from the viewer's point of view. */
export function describe(a: Activity, me: UUID, partnerName: string): string {
  const mine = a.actor_id === me;
  const who = mine ? 'You' : partnerName;
  const t = a.title ? `“${a.title}”` : '';
  switch (a.kind) {
    case 'paired':
      return mine ? `You paired up with ${partnerName}. Let the baking begin!` : `${partnerName} paired up with you. Let the baking begin!`;
    case 'unpaired':
      return `${who} unpaired.`;
    case 'task_added':
      return mine ? `You set ${partnerName} a task: ${t}` : `${partnerName} set you a task: ${t}`;
    case 'task_updated':
      return `${who} tweaked the task ${t}`;
    case 'task_removed':
      return `${who} removed the task ${t}`;
    case 'task_claimed':
      return mine ? `You marked ${t} as done` : `${partnerName} says they did ${t}`;
    case 'claim_withdrawn':
      return mine ? `You un-marked ${t}` : `${partnerName} un-marked ${t}`;
    case 'task_approved':
      return mine ? `You approved ${t} for ${partnerName}` : `${partnerName} approved your ${t}`;
    case 'task_declined':
      return mine ? `You sent ${t} back to the oven` : `${partnerName} sent ${t} back to the oven`;
    case 'reward_added':
      return `${who} wished for ${t}`;
    case 'reward_updated':
      return `${who} updated the wish ${t}`;
    case 'reward_removed':
      return `${who} removed the wish ${t}`;
    case 'reward_priced':
      return mine ? `You priced ${partnerName}’s wish ${t}` : `${partnerName} priced your wish ${t}`;
    case 'reward_redeemed':
      return mine ? `You cashed in ${t}` : `${partnerName} cashed in ${t}`;
    case 'redemption_cancelled':
      return `${who} cancelled ${t}. Brownies refunded.`;
    case 'redemption_delivered':
      return mine ? `You delivered ${t}` : `${partnerName} delivered your ${t}. Enjoy!`;
    case 'gift':
      return mine ? `You gifted ${partnerName} some brownies` : `${partnerName} gifted you brownies!`;
    case 'shared_proposed':
      return mine ? `You proposed a shared task: ${t}` : `${partnerName} proposed a shared task: ${t}`;
    case 'shared_changed':
      return mine ? `You suggested changes to ${t}` : `${partnerName} suggested changes to ${t}`;
    case 'shared_agreed':
      return mine ? `You agreed to ${t}` : `${partnerName} agreed to ${t}. It’s live!`;
    case 'shared_declined':
      return `${who} turned down ${t}`;
    case 'task_paused':
      return `${who} put ${t} on pause`;
    case 'task_resumed':
      return `${who} brought back ${t}`;
    case 'task_bumped':
      return mine ? `You warmed up ${t}` : `${partnerName} warmed up ${t}. It’s worth full price again!`;
    default:
      // an older copy of the app seeing a newer kind of entry
      return t ? `${who} updated ${t}` : `${who} made a change`;
  }
}
