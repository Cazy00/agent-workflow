// The local convenience launcher a project keeps as scripts/wf. Since MAINT-0018 it is templates/scripts/wf, so
// bin/wf-adopt installs it from the pinned release and bin/wf-upgrade refreshes it like the other installed files. Before
// v2.6.0 bin/wf-adopt wrote it from its own text, unchanged since it was introduced; a project's copy still equal to that
// text (its SHA-256 here) is the old release's copy, so an upgrade replaces it rather than leaving it to be merged by hand.
import { createHash } from 'node:crypto';

export const LEGACY_LAUNCHERS = ['a37358269532707af44412b90319c42e3b4ef0c7c33b2c48aebba80eb395e3c9'];
export const sha256 = text => createHash('sha256').update(text).digest('hex');
