# GiftStar family computer

Amazon will not let GiftStar's server read product pages. A normal browser on a
home internet connection can. This small program runs on one home computer (the
Mac mini). It opens Amazon pages for GiftStar and sends them back, so a pasted
`a.co` link fills in the name, price and picture.

If this computer is off, nothing breaks. GiftStar falls back to the friendly
"type it, take a photo, or use a screenshot" help.

## How it behaves

- It only opens Amazon links. GiftStar and this program both refuse anything else.
- One page at a time, a pause between pages, and at most 30 pages an hour.
- GiftStar remembers each result for 7 days, so the same link is not opened twice.
- If Amazon shows a "robot check" page, the program rests for 10 minutes. It does
  not try to get past the check.
- Amazon's terms do not allow automated access. This use is tiny, only for links
  our own family pastes. Keep it that way. Do not point other apps at it.

## Setup (Mac)

1. Install Node.js and Google Chrome if they are not there.
2. Make a secret: `openssl rand -hex 24`
3. In GitHub, open the GiftStar repo, then Settings, Secrets and variables,
   Actions. Add a secret named `AGENT_TOKEN` with that value. Run the deploy again.
4. Copy `.env.example` to `.env`. Put in the same secret and your API address.
5. Test one page: `npm install` then `node agent.mjs --test https://www.amazon.com/dp/B0GG9CQQ3N`
   It should print a name, price and picture. If it says "Blocked: YES", stop here.
6. Run `./install.sh`. It starts at login and keeps the Mac awake while it runs.
7. In System Settings, Energy, turn on "Prevent automatic sleeping when the display is off".

Watch it: `tail -f ~/.giftstar-agent/agent.log`
