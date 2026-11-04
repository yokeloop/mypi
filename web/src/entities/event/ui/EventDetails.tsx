import { FieldList } from '../../../shared/ui';
import { display, extraFields } from '../../../shared/lib';
import type { Rec } from '../../../shared/lib';

const KNOWN = ['id', 'from', 'to', 'kind', 'text', 'createdAt', 'deliveredAt'];

export function EventDetails({ event }: { event: Rec }) {
  return <FieldList rows={[...KNOWN.map(key => [key, display(event[key])] as [string, string]), ...extraFields(event, KNOWN)]} />;
}
