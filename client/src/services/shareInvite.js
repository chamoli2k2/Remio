import { toast } from 'sonner';
import { BRAND } from '../../../shared/brand.js';
import { inviteMessage, referralLink } from '../../../shared/referrals.js';

/** Hand the invite to whatever the device offers for sharing, or copy it where nothing does. */
export async function shareInvite({ code, goal }) {
  const link = referralLink(window.location.origin, code);
  const text = inviteMessage({ code, link, brand: BRAND.name, goal });
  try {
    if (navigator.share) { await navigator.share({ title: `Study with me on ${BRAND.name}`, text, url: link }); return; }
    await navigator.clipboard.writeText(text); toast.success('Invite copied. Paste it in a chat.');
  } catch (e) { if (e?.name !== 'AbortError') toast.error('Could not share. Copy the link instead.'); }
}
