import { assert, test } from 'orca/testing'
import { unseenHere, type SeenCard } from './unseen.ts'

const card = (extra: Partial<SeenCard> = {}): SeenCard => ({ key: 'a', watch: true, closed: false, state: 'working', mainState: 'working', stateAt: 100, unseenAt: null, ...extra })

test('a checked chat that stops working is unseen here, though the server never said so', () => {
  const marks = unseenHere()
  const working = [card()]
  marks.adorn(working, 1)
  assert.equal(working[0]!.unseenAt, null)
  // The server's own panel opened the box and cleared the mark before this machine asked.
  const done = [card({ state: 'done', stateAt: 200 })]
  marks.adorn(done, 2)
  assert.equal(done[0]!.unseenAt, 200)
  // It stays until it is seen here.
  const later = [card({ state: 'done', stateAt: 200 })]
  marks.adorn(later, 3)
  assert.equal(later[0]!.unseenAt, 200)
})

test('seen here, it is not marked again, and the server’s late mark does not bring it back', () => {
  const marks = unseenHere()
  marks.adorn([card()], 1)
  marks.adorn([card({ state: 'done', stateAt: 200, unseenAt: 200 })], 2)
  marks.saw('a')
  // A board from before the server cleared its mark.
  const stale = [card({ state: 'done', stateAt: 200, unseenAt: 200 })]
  marks.adorn(stale, 3)
  assert.equal(stale[0]!.unseenAt, null)
  const cleared = [card({ state: 'done', stateAt: 200 })]
  marks.adorn(cleared, 4)
  assert.equal(cleared[0]!.unseenAt, null)
})

test('the next turn that ends is unseen again', () => {
  const marks = unseenHere()
  marks.adorn([card()], 1)
  marks.adorn([card({ state: 'done', stateAt: 200 })], 2)
  marks.saw('a')
  marks.adorn([card({ stateAt: 300 })], 3)
  const again = [card({ state: 'done', stateAt: 400 })]
  marks.adorn(again, 4)
  assert.equal(again[0]!.unseenAt, 400)
})

test('working again, unchecked or closed: no mark', () => {
  for (const after of [card({ stateAt: 300 }), card({ state: 'done', watch: false }), card({ state: 'done', closed: true })]) {
    const marks = unseenHere()
    marks.adorn([card()], 1)
    marks.adorn([card({ state: 'done', stateAt: 200 })], 2)
    const board = [after]
    marks.adorn(board, 3)
    assert.equal(board[0]!.unseenAt ?? null, null)
  }
})

test('the first board seen starts nothing; Orca’s monitoring mode counts as a finished turn', () => {
  const marks = unseenHere()
  const first = [card({ state: 'done', stateAt: 50 })]
  marks.adorn(first, 1)
  assert.equal(first[0]!.unseenAt, null, 'it finished before this machine was looking')
  const fresh = unseenHere()
  fresh.adorn([card()], 1)
  const monitoring = [card({ state: 'working', mainState: 'done', stateAt: 200 })]
  fresh.adorn(monitoring, 2)
  assert.equal(monitoring[0]!.unseenAt, 200)
})

test('the server’s own mark is kept here after the server clears it', () => {
  const marks = unseenHere()
  marks.adorn([card({ state: 'done', stateAt: 200, unseenAt: 210 })], 1)
  const cleared = [card({ state: 'done', stateAt: 200 })]
  marks.adorn(cleared, 2)
  assert.equal(cleared[0]!.unseenAt, 210)
})
