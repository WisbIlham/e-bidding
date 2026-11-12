# eBid Majlis: PAS Kawasan Kota Bharu

A live hall auction for one lot: the vest of Almarhum Tuan Guru Nik Abdul Aziz Nik Mat,
at the Majlis Makan Malam Kutipan Dana PRU Ke-16. Starting price RM30,000, increment RM500.

The MC runs the auction in the hall. A committee member types every bid (name and amount)
in the admin page. Guests watch on their phones, and the projector shows the same data.
There are no guest accounts, no online payment and no QR codes. Payment is checked by hand
at the event.

| Page | Who | What |
|---|---|---|
| `/` | Guests (phone) | Story, photos, video, live price, bid list, winner |
| `/skrin.html` | Projector | Big price, leader, last bids, winner screen |
| `/admin/` | Committee (PIN) | Open/close, record bids, undo last, confirm payment, settings, CSV, reset |
| `api.php` | All pages | Public GET state (pages poll it every 1.5 to 2 seconds); admin POST actions with the `X-Pin` header |

## Data

Data is kept outside the web folder, so RunCloud atomic deploys do not wipe it:
`/home/<user>/ebid-data/` (or the `EBID_DATA` environment variable).

- `state.json`: the auction, including bidder phone numbers (admin only)
- `pin.txt`: the admin PIN. A random 6-digit PIN is made on the first request. To read or change it:
  `ssh ebid@<server> 'cat ~/ebid-data/pin.txt'`
- `backups/`: a copy of the state before every reset

## Run locally

```bash
EBID_DATA=/tmp/ebid-data php -S 127.0.0.1:8090
# guest:     http://127.0.0.1:8090/
# projector: http://127.0.0.1:8090/skrin.html
# admin:     http://127.0.0.1:8090/admin/   (PIN in /tmp/ebid-data/pin.txt)
```

The full white-label demo (shops, RM10 fee, mock Bayarcash, bots) is kept in git history
at commit `d48f3f8`.
