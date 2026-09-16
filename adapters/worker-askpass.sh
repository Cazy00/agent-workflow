#!/bin/sh
# Used only with an explicitly supplied worker credential; never searches secret stores.
case "$1" in
  *Username*) printf '%s\n' 'x-access-token' ;;
  *Password*) [ -n "$WF_WORKER_TOKEN" ] || exit 1; printf '%s\n' "$WF_WORKER_TOKEN" ;;
  *) exit 1 ;;
esac
