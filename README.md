# eBid Baju

Static HTML demo of a white-label online auction platform, with rules adapted from JPJeBid:
- an open live auction
- tier minimum price + minimum increment, with the increment doubled in the last 30 minutes
- an RM10 participation fee on a bidder's first bid per lot
- a win limit per bidder
- the winner pays within a set time, or the lot passes to the second-highest bidder

Demo shop: **PAS Kawasan Kota Bharu**, Bidaan Istimewa at the Majlis Makan Malam Kutipan Dana PRU Ke-16.

> Demo only. No real payments: the `pay/` pages are a sandbox mock of the Bayarcash payment page. All data lives in the browser's `localStorage`.

## Run (realtime: bids appear live on every phone and laptop)

```bash
node server.js
```

Then open http://localhost:8080/shop.html. The server prints the address for phones on the same Wi-Fi (e.g. `http://192.168.x.x:8080/shop.html`).

- `server.js` needs no packages.
- It keeps one shared auction state.
- It pushes every new bid to all devices with Server-Sent Events.
- It picks one device to run the simulated bidders. Turn these off with `settings.demoBots: false` in `assets/data.js`.

With a plain static server (`python3 -m http.server`, GitHub Pages) the demo still works, but each browser keeps its own data. The page shows "Paparan browser ini sahaja".

## Pages

| Area | Pages |
|---|---|
| Platform | `index.html` |
| Bidder | `shop.html`, `item.html`, `login.html`, `my-bids.html`, `inbox.html`, `checkout.html`, `favourites.html`, `history.html`, `profile.html` |
| Shop admin | `admin/index.html` (incl. the projector "Mod skrin besar"), `admin/items.html`, `admin/winners.html`, `admin/settings.html` |
| Super admin | `super/index.html` |
| Mock Bayarcash | `pay/bayarcash.html` → `pay/bank.html` → `pay/status.html` |

On the mock bank page, the sandbox banks behave like this:

| Bank | Result |
|---|---|
| SBI Bank A | success |
| SBI Bank B | failed |
| SBI Bank C | random |

Shared code lives in `assets/`. Design direction: `DESIGN.md`.
Use "Reset data demo" in the footer to start over.
