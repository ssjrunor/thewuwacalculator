/*
  Author: Runor Ewhro
  description: fallback copy for leaderboard error codes and card rejection
               statuses that do not include a message.
*/

import type { ApiError } from './api'

type Code = ApiError['error']['code']

const REASONS: Record<Code, string> = {
  bad_link: "hmm... that doesn't look like a card link. try the Kuro share link or the card's file name :P",
  not_kuro: "oopsies... that link isn't from Kuro. paste the original card link or its file name :P",
  fetch_failed: "uh oh... we couldn't download the card from Kuro. check the link and try again in a little while :(",
  too_large: "woah... that image is too big! try a smaller one :P",
  bad_image: "hmm... we couldn't read that image. try the original image or a different file :P",
  not_fresh: "oopsies... this card is too old for this claim. change your build in game, generate a new card and claim it within 15 minutes. an unchanged build can reuse an old card :P",
  uid_unreadable: "uh oh... we couldn't read the UID on this card. try generating a new card and send its original link :(",
  unreadable: "hmm... we couldn't read enough of this build to save it. try generating a new card and send its original link :(",
  incomplete_build: "oopsies... we couldn't read this card's equipped Echoes. try submitting the card again :P",
  read_failed: "oopsies... something went wrong on our side while reading this card. try submitting it again in a little while :(",
  opted_out: "oh... this UID has left the boards. claim the UID and rejoin from its profile before submitting more cards :P",
  blocked: "this card has been blocked from the boards. staff can review it if you think there's been a mistake.",
  duplicate: "hold on... we already have this submission. check its current status before sending it again :P",
  rate_limited: "woah... a few too many requests at once! give it a minute, then try again :P",
  unauthorized: "hold on... sign in or claim your UID before trying that :P",
  forbidden: "hmm... you don't have permission to do that.",
  not_found: "hmm... we couldn't find that. it may have been removed or made private.",
  bad_request: "oopsies... we couldn't accept those details. check what you entered and try again :P",
  turnstile_failed: "uh oh... the bot check didn't go through. complete the check and try again; refresh the page if it stays stuck :P",
  internal: "oopsies... something went wrong on our side. try again in a little while :(",
  suspended: "this UID or account is suspended. check your account standing for details and appeals.",
  muted: "this UID or account is muted, so it can't post or upload right now. check your account standing for details.",
}

export const reasonText = (code: Code | undefined): string => (code && REASONS[code]) || REASONS.internal
