import { InputError } from '../shared/errors.js';

export interface ArtifactVersions { reaches(commit: string): boolean; contains(commit: string, path: string): boolean }

export function checkArtifactReference(ref: { path: string; commit: string }, versions: ArtifactVersions | undefined): void {
  if (!versions || !versions.reaches(ref.commit) || !versions.contains(ref.commit, ref.path)) {
    throw new InputError('Unresolvable artifact reference: ' + ref.path + '@' + ref.commit);
  }
}
