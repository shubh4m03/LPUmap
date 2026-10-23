import type { Place } from '../../data/index.ts';
import { mailHref, safeExternalUrl, telHref } from '../../utils/safe-url.ts';
import { DetailSection, ExternalLink } from './DetailSection.tsx';
import { heightText, WHEELCHAIR_LABELS } from './place-format.ts';

const LINK = 'text-accent-text underline underline-offset-2 hover:no-underline';

function Contact({ contact }: { contact: NonNullable<Place['contact']> }) {
  const tel = contact.phone ? telHref(contact.phone) : null;
  const mail = contact.email ? mailHref(contact.email) : null;
  const web = contact.website ? safeExternalUrl(contact.website) : null;
  if (!contact.phone && !contact.email && !contact.website) return null;
  return (
    <DetailSection title="Contact (as published)" icon="phone">
      <ul className="space-y-1 text-sm">
        {contact.phone ? (
          <li>
            Phone:{' '}
            {tel ? (
              <a className={LINK} href={tel}>
                {contact.phone}
              </a>
            ) : (
              <span>{contact.phone}</span>
            )}
          </li>
        ) : null}
        {contact.email ? (
          <li>
            Email:{' '}
            {mail ? (
              <a className={LINK} href={mail}>
                {contact.email}
              </a>
            ) : (
              <span>{contact.email}</span>
            )}
          </li>
        ) : null}
        {contact.website ? (
          <li>
            Website:{' '}
            {web ? (
              <ExternalLink href={web}>{new URL(web).host}</ExternalLink>
            ) : (
              <span className="text-muted">listed, but not a safe web address, so no link is shown</span>
            )}
          </li>
        ) : null}
      </ul>
    </DetailSection>
  );
}

/** Contact, accessibility and building facts. */
export function PlaceFacts({ place }: { place: Place }) {
  const height = heightText(place);
  return (
    <>
      {place.contact ? <Contact contact={place.contact} /> : null}
      <DetailSection title="Accessibility" icon="wheelchair">
        <p className="text-sm text-text">
          {place.wheelchair === 'unknown' ? 'Wheelchair access: ' : null}
          {WHEELCHAIR_LABELS[place.wheelchair]}
        </p>
      </DetailSection>
      {height ? (
        <DetailSection title="Building" icon="building">
          <ul className="space-y-0.5 text-sm text-text">
            {place.levels !== undefined ? <li>{place.levels} floors (as mapped)</li> : null}
            <li>{height}</li>
          </ul>
        </DetailSection>
      ) : null}
    </>
  );
}
