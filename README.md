# Bible Guesser

A GeoGuessr-style game for the Bible. You're shown a verse (or two) describing an
event that happened at a real place. Click on the map where you think it happened.
The closer your guess, the more points you score.

## Concept
- Only use verses tied to a **located event** (a battle, miracle, journey, birth, etc.)
- Show the verse text + reference.
- Player clicks a spot on the map.
- Reveal the true location, draw a line between guess and answer, score by distance.
- 5 rounds per game, total score at the end.

## Running it
Just open `index.html` in a browser. No build step - it loads Leaflet from a CDN
and reads verses from `verses.json`.

> Note: some browsers block `fetch()` of local files via `file://`. If the verses
> don't load, run a tiny local server from this folder:
> ```
> python -m http.server 8000
> ```
> then visit http://localhost:8000

## Files
- `index.html` - page layout
- `style.css`  - styling
- `game.js`    - game logic (rounds, scoring, map clicks, haversine distance)
- `verses.json`- the verse + location dataset (edit/expand this!)

## Scoring
Distance between guess and answer is computed with the haversine formula.
- 0 km        -> 5000 points
- ~world away -> 0 points
Score decays exponentially: `5000 * exp(-distance_km / 1000)`.

## Ideas / TODO
- [ ] Add more verses (aim for 50+ so games feel fresh)
- [ ] Difficulty levels (famous events vs obscure ones)
- [ ] Use a historical-style map tileset instead of modern streets
- [ ] Optional "two verse" hint mode vs "one verse" hard mode
- [ ] Timer per round
- [ ] Categories: Old Testament / New Testament / Paul's journeys
