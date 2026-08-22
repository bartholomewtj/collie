Add the missing assertion in `web/src/components/bottom-nav.test.tsx`: after clicking Files, the location is `/files`.

Where: `web/src/components/bottom-nav.test.tsx`

Done means: the Files click test asserts the pathname is `/files`. The rest of the Files-tab implementation already in the working tree is unchanged.

Out of scope: `adws/`, new Files-tab behaviour, another version bump, rewriting tests that already passed review.
