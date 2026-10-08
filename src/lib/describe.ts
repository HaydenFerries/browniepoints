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
    default:
      return `${who} did something sweet`;
  }
}
