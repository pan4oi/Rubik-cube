// Layer-by-layer (beginner method) solver for the 3x3 cube.
//
// The game stores the cube as 26 rotating cubies. This module works on the
// equivalent 54-sticker facelet state, so the solver never touches three.js.
// It solves in a virtual frame with white on the bottom, which is the frame the
// classic beginner algorithms are written for, then converts every move back
// to the game's own faces.
//
// Stages:
//   1. White cross (virtual bottom)
//   2. White corners
//   3. Middle layer
//   4. Yellow cross
//   5. Yellow edges
//   6. Yellow corners
//   7. Final orientation
//
// Stage 1 is a breadth-first search over just the four white edges. Stages 2-7
// search short sequences of known beginner macros, with a goal that also
// preserves everything solved by earlier stages. That keeps the output human
// readable without hand-writing every possible case.

( function ( root, factory ) {

  const api = factory();

  if ( typeof module === 'object' && module.exports ) module.exports = api;
  else root.TutorialSolver = api;

} )( typeof self !== 'undefined' ? self : this, function () {

  'use strict';

  const FACES = [ 'U', 'R', 'F', 'D', 'L', 'B' ];

  // Facelet geometry. For every face, n is its outward normal and u, v are a
  // right-handed tangent basis (u x v = n). A facelet at (row, col) sits at
  // n + u * (col - 1) + v * (row - 1), so positions are integers in -1..1.
  const BASIS = {
    U: { n: [ 0, 1, 0 ], u: [ 1, 0, 0 ], v: [ 0, 0, - 1 ] },
    R: { n: [ 1, 0, 0 ], u: [ 0, 1, 0 ], v: [ 0, 0, 1 ] },
    F: { n: [ 0, 0, 1 ], u: [ 1, 0, 0 ], v: [ 0, 1, 0 ] },
    D: { n: [ 0, - 1, 0 ], u: [ 1, 0, 0 ], v: [ 0, 0, 1 ] },
    L: { n: [ - 1, 0, 0 ], u: [ 0, 0, 1 ], v: [ 0, 1, 0 ] },
    B: { n: [ 0, 0, - 1 ], u: [ 0, 1, 0 ], v: [ 1, 0, 0 ] },
  };

  // Colour of each centre once the real cube is rotated 180 degrees about x
  // (white is then on the virtual bottom). Sticker colours themselves stay in
  // the game's letters: U is white, D yellow, F red, R blue, L green, B orange.
  const CENTER = { U: 'D', R: 'R', F: 'B', D: 'U', L: 'L', B: 'F' };

  const FACE_INDEX = { U: 0, R: 1, F: 2, D: 3, L: 4, B: 5 };
  const INDEX_FACE = FACES;

  const VIRTUAL_TO_REAL = { U: 'D', R: 'R', F: 'B', D: 'U', L: 'L', B: 'F' };

  const MOVES = [];
  const MOVE_BY_NOTATION = {};

  const GEOM = [];
  const FACE_OF = [];
  const POS_KEY = [];
  const INDICES_AT = {};
  const SLOT_COLORS = {};

  let MOVE_PERMS = {};

  // -------------------------------------------------------------------------
  // Small vector helpers (all coordinates are exact -1, 0 or 1).
  // -------------------------------------------------------------------------

  function dot( a, b ) {

    return a[ 0 ] * b[ 0 ] + a[ 1 ] * b[ 1 ] + a[ 2 ] * b[ 2 ];

  }

  function vec( x, y, z ) {

    return [ x, y, z ];

  }

  function keyOf( p ) {

    return p[ 0 ] + ',' + p[ 1 ] + ',' + p[ 2 ];

  }

  function faceOfNormal( n ) {

    for ( let i = 0; i < FACES.length; i++ ) {

      const basis = BASIS[ FACES[ i ] ];
      if ( n[ 0 ] === basis.n[ 0 ] && n[ 1 ] === basis.n[ 1 ] && n[ 2 ] === basis.n[ 2 ] ) return i;

    }

    return - 1;

  }

  function faceletIndex( p, n ) {

    const face = faceOfNormal( n );
    if ( face < 0 ) return - 1;

    const basis = BASIS[ FACES[ face ] ];
    const a = dot( p, basis.u );
    const b = dot( p, basis.v );

    if ( a < - 1 || a > 1 || b < - 1 || b > 1 ) return - 1;

    return face * 9 + ( b + 1 ) * 3 + ( a + 1 );

  }

  function rotateVector( v, axis, quarterTurns ) {

    const angle = - quarterTurns * Math.PI / 2;
    const c = Math.round( Math.cos( angle ) );
    const s = Math.round( Math.sin( angle ) );

    const cross = [
      axis[ 1 ] * v[ 2 ] - axis[ 2 ] * v[ 1 ],
      axis[ 2 ] * v[ 0 ] - axis[ 0 ] * v[ 2 ],
      axis[ 0 ] * v[ 1 ] - axis[ 1 ] * v[ 0 ],
    ];

    const along = dot( axis, v );

    return [
      Math.round( v[ 0 ] * c + cross[ 0 ] * s + axis[ 0 ] * along * ( 1 - c ) ),
      Math.round( v[ 1 ] * c + cross[ 1 ] * s + axis[ 1 ] * along * ( 1 - c ) ),
      Math.round( v[ 2 ] * c + cross[ 2 ] * s + axis[ 2 ] * along * ( 1 - c ) ),
    ];

  }

  // -------------------------------------------------------------------------
  // Facelet table and move permutations.
  // -------------------------------------------------------------------------

  ( function buildGeometry() {

    for ( let f = 0; f < FACES.length; f++ ) {

      const face = FACES[ f ];
      const basis = BASIS[ face ];

      for ( let row = 0; row < 3; row++ ) {
        for ( let col = 0; col < 3; col++ ) {

          const index = f * 9 + row * 3 + col;
          const p = [
            basis.n[ 0 ] + basis.u[ 0 ] * ( col - 1 ) + basis.v[ 0 ] * ( row - 1 ),
            basis.n[ 1 ] + basis.u[ 1 ] * ( col - 1 ) + basis.v[ 1 ] * ( row - 1 ),
            basis.n[ 2 ] + basis.u[ 2 ] * ( col - 1 ) + basis.v[ 2 ] * ( row - 1 ),
          ];

          GEOM[ index ] = { face: face, p: p, n: basis.n };
          FACE_OF[ index ] = face;
          POS_KEY[ index ] = keyOf( p );

          if ( ! INDICES_AT[ POS_KEY[ index ] ] ) INDICES_AT[ POS_KEY[ index ] ] = [];
          INDICES_AT[ POS_KEY[ index ] ].push( index );

        }
      }

    }

    Object.keys( INDICES_AT ).forEach( key => {

      const indices = INDICES_AT[ key ];
      SLOT_COLORS[ key ] = indices.map( index => CENTER[ FACE_OF[ index ] ] ).sort();

    } );

  } )();

  ( function buildMoves() {

    for ( let f = 0; f < FACES.length; f++ ) {

      const face = FACES[ f ];
      const axis = BASIS[ face ].n;

      for ( const turns of [ 1, - 1, 2 ] ) {

        const perm = new Array( 54 );

        for ( let index = 0; index < 54; index++ ) {

          const geom = GEOM[ index ];
          let p = geom.p;
          let n = geom.n;

          if ( dot( p, axis ) === 1 ) {

            p = rotateVector( p, axis, turns );
            n = rotateVector( n, axis, turns );

          }

          const target = faceletIndex( p, n );
          if ( target < 0 ) throw new Error( 'Bad facelet move' );
          perm[ index ] = target;

        }

        const notation = face + ( turns === 2 ? '2' : turns === - 1 ? "'" : '' );
        const move = { face: face, turns: turns, notation: notation, perm: perm };

        MOVES.push( move );
        MOVE_BY_NOTATION[ notation ] = move;
        if ( ! MOVE_PERMS[ face ] ) MOVE_PERMS[ face ] = {};
        MOVE_PERMS[ face ][ turns ] = perm;

      }

    }

  } )();

  function applyPerm( state, perm ) {

    const out = new Array( 54 );

    for ( let i = 0; i < 54; i++ ) out[ perm[ i ] ] = state[ i ];

    return out;

  }

  function applyMove( state, face, turns ) {

    return applyPerm( state, MOVE_PERMS[ face ][ turns ] );

  }

  function applyNotation( state, notation ) {

    const move = MOVE_BY_NOTATION[ notation ];
    if ( ! move ) throw new Error( 'Unknown move: ' + notation );
    return applyPerm( state, move.perm );

  }

  function applySequence( state, sequence ) {

    let out = state;
    for ( const notation of sequence ) out = applyNotation( out, notation );
    return out;

  }

  function invertNotation( notation ) {

    if ( notation.endsWith( '2' ) ) return notation;
    if ( notation.endsWith( "'" ) ) return notation.slice( 0, - 1 );
    return notation + "'";

  }

  function compose( sequence ) {

    // Combined permutation of a sequence: out[perm[i]] = state[i].
    let perm = null;

    for ( const notation of sequence ) {

      const move = MOVE_BY_NOTATION[ notation ];

      if ( ! perm ) {

        perm = move.perm.slice();

      } else {

        const next = new Array( 54 );

        // perm maps a source facelet to its destination. The next move is
        // applied after it, so the combined destination is perm2[perm1[i]].
        for ( let i = 0; i < 54; i++ ) next[ i ] = move.perm[ perm[ i ] ];

        perm = next;

      }

    }

    return perm;

  }

  // -------------------------------------------------------------------------
  // State helpers.
  // -------------------------------------------------------------------------

  function solvedReal() {

    const state = new Array( 54 );
    for ( let i = 0; i < 54; i++ ) state[ i ] = FACE_OF[ i ];
    return state;

  }

  function solvedVirtual() {

    const state = new Array( 54 );
    for ( let i = 0; i < 54; i++ ) state[ i ] = CENTER[ FACE_OF[ i ] ];
    return state;

  }

  function clone( state ) {

    return state.slice();

  }

  function isRealSolved( state ) {

    for ( let i = 0; i < 54; i++ ) if ( state[ i ] !== FACE_OF[ i ] ) return false;
    return true;

  }

  function isVirtualSolved( state ) {

    for ( let i = 0; i < 54; i++ ) if ( state[ i ] !== CENTER[ FACE_OF[ i ] ] ) return false;
    return true;

  }

  function rotateX180( state ) {

    const out = new Array( 54 );

    for ( let i = 0; i < 54; i++ ) {

      const geom = GEOM[ i ];
      const p = [ geom.p[ 0 ], - geom.p[ 1 ], - geom.p[ 2 ] ];
      const n = [ geom.n[ 0 ], - geom.n[ 1 ], - geom.n[ 2 ] ];
      const target = faceletIndex( p, n );

      out[ target ] = state[ i ];

    }

    return out;

  }

  function stateFromStickers( stickers ) {

    const state = new Array( 54 ).fill( null );

    for ( const sticker of stickers ) {

      const index = faceletIndex( sticker.pos, sticker.normal );
      if ( index < 0 ) throw new Error( 'Sticker outside the cube' );
      state[ index ] = sticker.color;

    }

    if ( state.some( color => ! color ) ) throw new Error( 'Incomplete cube state' );

    return state;

  }

  function stateToStickers( state ) {

    return state.map( ( color, index ) => ( {
      pos: GEOM[ index ].p,
      normal: GEOM[ index ].n,
      color: color,
    } ) );

  }

  function faceIndicesAt( p ) {

    return INDICES_AT[ keyOf( p ) ] || [];

  }

  function colorsAt( state, p ) {

    return faceIndicesAt( p ).map( index => state[ index ] );

  }

  function colorsAtKey( state, key ) {

    return ( INDICES_AT[ key ] || [] ).map( index => state[ index ] );

  }

  function isSlotSolved( state, p ) {

    const indices = faceIndicesAt( p );
    if ( ! indices.length ) return false;

    for ( const index of indices ) {

      if ( state[ index ] !== CENTER[ FACE_OF[ index ] ] ) return false;

    }

    return true;

  }

  function isSlotSolvedKey( state, key ) {

    const indices = INDICES_AT[ key ] || [];
    if ( ! indices.length ) return false;

    for ( const index of indices ) {

      if ( state[ index ] !== CENTER[ FACE_OF[ index ] ] ) return false;

    }

    return true;

  }

  function sameColorSet( a, b ) {

    if ( a.length !== b.length ) return false;
    const aa = a.slice().sort().join( '' );
    const bb = b.slice().sort().join( '' );
    return aa === bb;

  }

  // -------------------------------------------------------------------------
  // Slot lists.
  // -------------------------------------------------------------------------

  const ALL_EDGES = [];
  const ALL_CORNERS = [];

  ( function buildSlots() {

    for ( const key of Object.keys( INDICES_AT ) ) {

      const [ x, y, z ] = key.split( ',' ).map( Number );
      const count = ( x !== 0 ? 1 : 0 ) + ( y !== 0 ? 1 : 0 ) + ( z !== 0 ? 1 : 0 );

      if ( count === 2 ) ALL_EDGES.push( [ x, y, z ] );
      if ( count === 3 ) ALL_CORNERS.push( [ x, y, z ] );

    }

    ALL_EDGES.sort( ( a, b ) => ( b[ 1 ] - a[ 1 ] ) || ( b[ 2 ] - a[ 2 ] ) || ( b[ 0 ] - a[ 0 ] ) );
    ALL_CORNERS.sort( ( a, b ) => ( b[ 1 ] - a[ 1 ] ) || ( b[ 2 ] - a[ 2 ] ) || ( b[ 0 ] - a[ 0 ] ) );

  } )();

  const D_EDGES = ALL_EDGES.filter( p => p[ 1 ] === - 1 );
  const D_CORNERS = ALL_CORNERS.filter( p => p[ 1 ] === - 1 );
  const MID_EDGES = ALL_EDGES.filter( p => p[ 1 ] === 0 );
  const U_EDGES = ALL_EDGES.filter( p => p[ 1 ] === 1 );
  const U_CORNERS = ALL_CORNERS.filter( p => p[ 1 ] === 1 );
  const SIDE_COLORS = [ 'R', 'F', 'L', 'B' ];

  // -------------------------------------------------------------------------
  // Goal predicates.
  // -------------------------------------------------------------------------

  function isCross( state ) {

    return D_EDGES.every( p => isSlotSolved( state, p ) );

  }

  function isDLayer( state ) {

    return D_EDGES.every( p => isSlotSolved( state, p ) ) &&
      D_CORNERS.every( p => isSlotSolved( state, p ) );

  }

  function isMiddle( state ) {

    return isDLayer( state ) && MID_EDGES.every( p => isSlotSolved( state, p ) );

  }

  function uEdgesOriented( state ) {

    const uFace = FACE_INDEX.U;

    for ( const p of U_EDGES ) {

      const indices = faceIndicesAt( p );
      const uIndex = indices.find( index => FACE_OF[ index ] === 'U' );
      if ( state[ uIndex ] !== CENTER.U ) return false;

    }

    return true;

  }

  function uEdgesSolved( state ) {

    return U_EDGES.every( p => isSlotSolved( state, p ) );

  }

  function uCornersPlaced( state ) {

    for ( const p of U_CORNERS ) {

      const colors = colorsAt( state, p );
      if ( ! sameColorSet( colors, SLOT_COLORS[ keyOf( p ) ] ) ) return false;

    }

    return true;

  }

  function uCornersOriented( state ) {

    const uFace = FACE_INDEX.U;

    for ( const p of U_CORNERS ) {

      const indices = faceIndicesAt( p );
      const uIndex = indices.find( index => FACE_OF[ index ] === 'U' );
      if ( state[ uIndex ] !== CENTER.U ) return false;

    }

    return true;

  }

  function isSolvedVirtual( state ) {

    return isVirtualSolved( state );

  }

  // -------------------------------------------------------------------------
  // Cross: BFS on the four white edges only.
  // -------------------------------------------------------------------------

  function crossKey( state ) {

    const parts = [];

    for ( const side of SIDE_COLORS ) {

      let whiteIndex = - 1;
      let sideIndex = - 1;

      for ( const p of ALL_EDGES ) {

        const indices = faceIndicesAt( p );
        const colors = indices.map( index => state[ index ] );
        if ( ! colors.includes( 'U' ) || ! colors.includes( side ) ) continue;

        const w = indices.find( index => state[ index ] === 'U' );
        const s = indices.find( index => state[ index ] === side );

        if ( w !== undefined && s !== undefined ) {

          whiteIndex = w;
          sideIndex = s;
          break;

        }

      }

      parts.push( side + whiteIndex + ':' + sideIndex );

    }

    return parts.join( '|' );

  }

  function reconstructCross( front, back, meetingKey ) {

    const path = [];
    let key = meetingKey;

    while ( front.has( key ) && front.get( key ).parent !== null ) {

      const node = front.get( key );
      path.unshift( node.move.notation );
      key = node.parent;

    }

    key = meetingKey;

    while ( back.has( key ) && back.get( key ).parent !== null ) {

      const node = back.get( key );
      path.push( node.move.notation );
      key = node.parent;

    }

    return path;

  }

  // Bidirectional BFS over the four cross edges. The abstract graph has about
  // 190k states; meeting in the middle keeps the tutorial responsive even for
  // awkward scrambles. Other pieces are ignored, so the path is a legal cross
  // solution without pretending to be an optimal whole-cube solve.
  function solveCross( state ) {

    if ( isCross( state ) ) return [];

    const startKey = crossKey( state );
    const goalState = solvedVirtual();
    const goalKey = crossKey( goalState );

    if ( startKey === goalKey ) return [];

    const front = new Map();
    const back = new Map();

    front.set( startKey, { state: state, parent: null, move: null } );
    back.set( goalKey, { state: goalState, parent: null, move: null } );

    let frontQueue = [ startKey ];
    let backQueue = [ goalKey ];

    for ( let depth = 0; depth < 8; depth++ ) {

      const nextFront = [];

      for ( const key of frontQueue ) {

        const node = front.get( key );

        for ( const move of MOVES ) {

          const next = applyPerm( node.state, move.perm );
          const nextKey = crossKey( next );

          if ( back.has( nextKey ) ) {

            front.set( nextKey, { state: next, parent: key, move: move } );
            return reconstructCross( front, back, nextKey );

          }

          if ( front.has( nextKey ) ) continue;

          front.set( nextKey, { state: next, parent: key, move: move } );
          nextFront.push( nextKey );

        }

      }

      frontQueue = nextFront;

      const nextBack = [];

      for ( const key of backQueue ) {

        const node = back.get( key );

        for ( const move of MOVES ) {

          const inverse = MOVE_BY_NOTATION[ invertNotation( move.notation ) ];
          const next = applyPerm( node.state, inverse.perm );
          const nextKey = crossKey( next );

          if ( front.has( nextKey ) ) {

            back.set( nextKey, { state: next, parent: key, move: move } );
            return reconstructCross( front, back, nextKey );

          }

          if ( back.has( nextKey ) ) continue;

          back.set( nextKey, { state: next, parent: key, move: move } );
          nextBack.push( nextKey );

        }

      }

      backQueue = nextBack;

      if ( ! frontQueue.length && ! backQueue.length ) break;

    }

    return null;

  }

  // -------------------------------------------------------------------------
  // Macro searches.
  // -------------------------------------------------------------------------

  function expandMacro( moves ) {

    return moves.slice();

  }

  function macro( name, moves ) {

    return { name: name, moves: moves, perm: compose( moves ) };

  }

  function searchMacros( state, macros, depthLimit, goal ) {

    if ( goal( state ) ) return [];

    const queue = [ { state: state, path: [] } ];
    const seen = new Set( [ state.join( '' ) ] );
    let head = 0;

    while ( head < queue.length ) {

      const node = queue[ head++ ];

      if ( node.path.length >= depthLimit ) continue;

      for ( const entry of macros ) {

        const next = applyPerm( node.state, entry.perm );
        const key = next.join( '' );
        if ( seen.has( key ) ) continue;

        const path = node.path.concat( [ entry ] );

        if ( goal( next ) ) return path;

        seen.add( key );
        queue.push( { state: next, path: path } );

      }

    }

    return null;

  }

  const CORNER_TRIGGERS = {
    '1,-1,1': [ 'R', 'U', "R'", "U'" ],
    '-1,-1,1': [ "L'", "U'", 'L', 'U' ],
    '1,-1,-1': [ "R'", "U'", 'R', 'U' ],
    '-1,-1,-1': [ 'L', 'U', "L'", "U'" ],
  };

  function findCornerByColors( state, colorKey ) {

    const colors = SLOT_COLORS[ colorKey ];

    for ( const p of D_CORNERS.concat( U_CORNERS ) ) {

      if ( sameColorSet( colorsAt( state, p ), colors ) ) return p;

    }

    return null;

  }

  function findUCornerByColors( state, colorKey ) {

    for ( const p of U_CORNERS ) {

      if ( colorsAt( state, p ).slice().sort().join( '' ) === colorKey ) return p;

    }

    return null;

  }

  // The classic corner insertion. Each of the four bottom slots has a
  // four-move trigger that only disturbs that slot among the bottom corners.
  // Rotate U to put the target corner above its slot, then repeat the trigger
  // until the corner drops in. No search needed, and every move is a standard
  // beginner move.
  function solveCorner( state, target ) {

    const targetKey = keyOf( target );
    const targetTop = [ target[ 0 ], 1, target[ 2 ] ];
    const targetTopKey = keyOf( targetTop );
    const trigger = CORNER_TRIGGERS[ targetKey ];
    const moves = [];

    if ( ! trigger ) return null;

    for ( let attempt = 0; attempt < 32; attempt++ ) {

      if ( isSlotSolved( state, target ) ) return moves;

      const pos = findCornerByColors( state, targetKey );
      if ( ! pos ) return null;

      if ( pos[ 1 ] === - 1 ) {

        const pop = CORNER_TRIGGERS[ keyOf( pos ) ];
        if ( ! pop ) return null;

        state = applySequence( state, pop );
        moves.push.apply( moves, pop );

      } else {

        // The corner is in the top layer. Find the U turn that puts it
        // directly above its target slot.
        let aligned = null;
        let alignMoves = null;

        for ( const turn of [ [], [ 'U' ], [ 'U2' ], [ "U'" ] ] ) {

          let trial = state;

          for ( const move of turn ) trial = applyNotation( trial, move );

          const at = findCornerByColors( trial, targetKey );
          if ( at && keyOf( at ) === targetTopKey ) {

            aligned = trial;
            alignMoves = turn;
            break;

          }

        }

        if ( ! aligned ) return null;

        state = aligned;
        moves.push.apply( moves, alignMoves );

        state = applySequence( state, trigger );
        moves.push.apply( moves, trigger );

      }

      if ( ! isCross( state ) ) return null;

    }

    return null;

  }

  // Rotate a sequence of face turns around the U axis. `steps` is the number
  // of clockwise quarter turns applied to the whole cube before reading the
  // algorithm. This lets one FR insert be reused for all four middle slots.
  function rotateSequenceY( sequence, steps ) {

    const map = { U: 'U', D: 'D' };
    const cycle = [ 'R', 'F', 'L', 'B' ];
    let forward = { R: 'F', F: 'L', L: 'B', B: 'R' };
    let backward = { F: 'R', L: 'F', B: 'L', R: 'B' };

    let mapping = { U: 'U', D: 'D', R: 'R', F: 'F', L: 'L', B: 'B' };

    for ( let i = 0; i < ( ( steps % 4 ) + 4 ) % 4; i++ ) {

      const next = {};
      for ( const face of FACES ) next[ face ] = mapping[ backward[ face ] || face ];
      mapping = next;

    }

    return sequence.map( notation => mapping[ notation[ 0 ] ] + notation.slice( 1 ) );

  }

  const RIGHT_INSERT = [ 'U', 'R', "U'", "R'", "U'", "F'", 'U', 'F' ];
  const LEFT_INSERT = [ "U'", "L'", 'U', 'L', 'U', 'F', "U'", "F'" ];

  const MIDDLE_MACROS = [];

  for ( const turns of [ 1, - 1, 2 ] ) {

    MIDDLE_MACROS.push( macro( 'U' + ( turns === 1 ? '' : turns === - 1 ? "'" : '2' ), [ 'U' + ( turns === 1 ? '' : turns === - 1 ? "'" : '2' ) ] ) );

  }

  for ( let k = 0; k < 4; k++ ) {

    const right = rotateSequenceY( RIGHT_INSERT, k );
    const left = rotateSequenceY( LEFT_INSERT, k );

    MIDDLE_MACROS.push( macro( 'right insert ' + k, right ) );
    MIDDLE_MACROS.push( macro( 'right insert inverse ' + k, right.slice().reverse().map( invertNotation ) ) );
    MIDDLE_MACROS.push( macro( 'left insert ' + k, left ) );
    MIDDLE_MACROS.push( macro( 'left insert inverse ' + k, left.slice().reverse().map( invertNotation ) ) );

  }

  function solveMiddleEdge( state, target, previous ) {

    const goal = next => isDLayer( next ) &&
      previous.every( p => isSlotSolved( next, p ) ) &&
      isSlotSolved( next, target );

    if ( goal( state ) ) return [];

    let path = searchMacros( state, MIDDLE_MACROS, 3, goal );
    if ( ! path ) path = searchMacros( state, MIDDLE_MACROS, 4, goal );

    return path;

  }

  // -------------------------------------------------------------------------
  // Last layer.
  // -------------------------------------------------------------------------

  const OLL_EDGE = macro( 'yellow cross', [ 'F', 'R', 'U', "R'", "U'", "F'" ] );
  const U_PERM_A = macro( 'edge cycle', [ 'R', "U'", 'R', 'U', 'R', 'U', 'R', "U'", "R'", "U'", 'R2' ] );
  const U_PERM_B = macro( 'edge cycle back', [ 'R2', 'U', 'R', 'U', "R'", "U'", "R'", "U'", "R'", 'U', "R'" ] );
  const T_PERM = macro( 'T perm', [ 'R', 'U', "R'", "U'", "R'", 'F', 'R2', "U'", "R'", "U'", 'R', 'U', "R'", "F'" ] );
  const A_PERM = macro( 'A perm', [ "R'", 'F', "R'", 'B2', 'R', "F'", "R'", 'B2', 'R2' ] );
  const TWIST = macro( 'corner twist', [ "R'", "D'", 'R', 'D', "R'", "D'", 'R', 'D' ] );
  const TWIST_TWICE = macro( 'corner twist twice', TWIST.moves.concat( TWIST.moves ) );

  const U_TURNS = [
    macro( 'U', [ 'U' ] ),
    macro( "U'", [ "U'" ] ),
    macro( 'U2', [ 'U2' ] ),
  ];

  const OLL_MACROS = U_TURNS.concat( [ OLL_EDGE, macro( 'yellow cross inverse', OLL_EDGE.moves.slice().reverse().map( invertNotation ) ) ] );
  const EDGE_PERM_MACROS = U_TURNS.concat( [ U_PERM_A, U_PERM_B ] );
  const CORNER_PERM_MACROS = U_TURNS.concat( [ A_PERM, macro( 'A perm inverse', A_PERM.moves.slice().reverse().map( invertNotation ) ) ] );
  // Reduced last-layer state. T perm and the U turns change corners too, so a
  // full-state BFS wastes most of its time on pieces this stage does not care
  // about. These keys describe only what the stage must fix.
  function uEdgeKey( state ) {

    let key = '';

    for ( const p of U_EDGES ) {

      const colors = colorsAt( state, p );
      const side = colors.find( color => color !== CENTER.U );
      key += side || '?';

    }

    return key;

  }

  const U_EDGE_TARGET = U_EDGES.map( p => {

    return SLOT_COLORS[ keyOf( p ) ].find( color => color !== CENTER.U );

  } ).join( '' );

  function uCornerKey( state ) {

    let key = '';

    for ( const p of U_CORNERS ) {

      key += colorsAt( state, p ).slice().sort().join( '' ) + '|';

    }

    return key;

  }

  const U_CORNER_TARGET = U_CORNERS.map( p => {

    return SLOT_COLORS[ keyOf( p ) ].slice().sort().join( '' );

  } ).join( '|' ) + '|';

  function searchReduced( start, macros, depthLimit, keyFn, goalKey ) {

    if ( keyFn( start ) === goalKey ) return [];

    const queue = [ { state: start, path: [] } ];
    const seen = new Set( [ keyFn( start ) ] );
    let head = 0;

    while ( head < queue.length ) {

      const node = queue[ head++ ];

      if ( node.path.length >= depthLimit ) continue;

      for ( const entry of macros ) {

        const next = applyPerm( node.state, entry.perm );
        const key = keyFn( next );
        if ( seen.has( key ) ) continue;

        const path = node.path.concat( [ entry ] );

        if ( key === goalKey ) return path;

        seen.add( key );
        queue.push( { state: next, path: path } );

      }

    }

    return null;

  }

  function solveYellowCross( state ) {

    const goal = next => isMiddle( next ) && uEdgesOriented( next );
    if ( goal( state ) ) return [];

    return searchMacros( state, OLL_MACROS, 4, goal ) ||
      searchMacros( state, OLL_MACROS, 5, goal );

  }

  function solveYellowEdges( state ) {

    const goal = next => isMiddle( next ) && uEdgesSolved( next );
    if ( goal( state ) ) return [];

    const path = searchReduced( state, EDGE_PERM_MACROS, 8, uEdgeKey, U_EDGE_TARGET );
    if ( ! path ) return null;

    let check = state;
    for ( const entry of path ) check = applyPerm( check, entry.perm );

    return goal( check ) ? path : null;

  }

  function solveYellowCorners( state ) {

    const goal = next => isMiddle( next ) && uEdgesSolved( next ) && uCornersPlaced( next );
    if ( goal( state ) ) return [];

    // A perm preserves the edges and the U turns rotate both layers, so the
    // corner key alone can stop at a U rotation that misaligns the edges.
    // Include the edge key in the state so the path keeps both correct.
    const keyFn = next => uCornerKey( next ) + '#' + uEdgeKey( next );
    const goalKey = U_CORNER_TARGET + '#' + U_EDGE_TARGET;

    const path = searchReduced( state, CORNER_PERM_MACROS, 8, keyFn, goalKey );
    if ( ! path ) {
      debugLog( 'corner perm no path key=' + keyFn( state ) + ' target=' + goalKey );
      return null;
    }

    let check = state;
    for ( const entry of path ) check = applyPerm( check, entry.perm );

    if ( ! goal( check ) ) {
      debugLog( 'corner perm goal fail: middle=' + isMiddle( check ) + ' edges=' + uEdgesSolved( check ) + ' placed=' + uCornersPlaced( check ) );
      return null;
    }

    return path;

  }

  function cornerOrientedAt( state, p ) {

    const indices = faceIndicesAt( p );
    const uIndex = indices.find( index => FACE_OF[ index ] === 'U' );

    return uIndex !== undefined && state[ uIndex ] === CENTER.U;

  }

  // The classic final corner step: hold an unoriented corner at UFR, repeat
  // (R' D' R D) until yellow points up, then move the next corner into UFR
  // with a U turn. The first two layers look scrambled in the middle of this
  // stage - that is normal for this beginner method - and come back at the end.
  function solveFinalOrientation( state ) {

    if ( isVirtualSolved( state ) ) return [];

    let current = state;
    const moves = [];
    const targetSpot = [ 1, 1, 1 ];

    for ( let corner = 0; corner < 4; corner++ ) {

      let target = null;

      for ( const p of U_CORNERS ) {

        if ( ! cornerOrientedAt( current, p ) ) { target = p; break; }

      }

      if ( ! target ) break;

      const colorKey = colorsAt( current, target ).slice().sort().join( '' );
      let guard = 0;

      while ( keyOf( target ) !== keyOf( targetSpot ) && guard < 4 ) {

        current = applyNotation( current, 'U' );
        moves.push( 'U' );
        target = findUCornerByColors( current, colorKey );
        guard++;

      }

      if ( ! target || keyOf( target ) !== keyOf( targetSpot ) ) return null;

      for ( let twist = 0; twist < 4; twist++ ) {

        if ( cornerOrientedAt( current, targetSpot ) ) break;

        current = applySequence( current, TWIST.moves );
        moves.push.apply( moves, TWIST.moves );

        const still = findUCornerByColors( current, colorKey );
        if ( ! still || keyOf( still ) !== keyOf( targetSpot ) ) return null;

      }

      if ( ! cornerOrientedAt( current, targetSpot ) ) return null;

    }

    for ( const turn of [ [], [ 'U' ], [ 'U2' ], [ "U'" ] ] ) {

      let trial = current;
      for ( const move of turn ) trial = applyNotation( trial, move );

      if ( isVirtualSolved( trial ) ) {

        moves.push.apply( moves, turn );
        return moves;

      }

    }

    return null;

  }

  // -------------------------------------------------------------------------
  // Stage assembly.
  // -------------------------------------------------------------------------

  const STAGES = [
    {
      key: 'cross',
      name: 'White Cross',
      description: 'Build the white cross on top, with each side colour matching its centre.',
    },
    {
      key: 'corners',
      name: 'White Corners',
      description: 'Drop the white corners into place to finish the white face.',
    },
    {
      key: 'middle',
      name: 'Middle Layer',
      description: 'Slide the four middle-layer edges into their slots.',
    },
    {
      key: 'yellow-cross',
      name: 'Yellow Cross',
      description: 'Orient the yellow edges until they form a cross on the yellow face.',
    },
    {
      key: 'yellow-edges',
      name: 'Yellow Edges',
      description: 'Cycle the yellow edges until each one matches its side centre.',
    },
    {
      key: 'yellow-corners',
      name: 'Yellow Corners',
      description: 'Move the yellow corners into their correct positions.',
    },
    {
      key: 'final',
      name: 'Final Orientation',
      description: 'Twist the last corners until the yellow face is complete.',
    },
  ];

  function flattenMacros( macros ) {

    const moves = [];

    for ( const entry of macros ) {

      for ( const notation of entry.moves ) moves.push( notation );

    }

    return moves;

  }

  function simplifyMoves( moves ) {

    const out = [];

    for ( const notation of moves ) {

      const face = notation[ 0 ];
      const turns = notation.endsWith( '2' ) ? 2 : notation.endsWith( "'" ) ? - 1 : 1;
      const last = out[ out.length - 1 ];

      if ( last && last.face === face ) {

        out.pop();

        let sum = ( last.turns + turns ) % 4;
        if ( sum < 0 ) sum += 4;

        if ( sum === 1 ) out.push( { face: face, turns: 1, notation: face } );
        else if ( sum === 2 ) out.push( { face: face, turns: 2, notation: face + '2' } );
        else if ( sum === 3 ) out.push( { face: face, turns: - 1, notation: face + "'" } );

      } else {

        out.push( { face: face, turns: turns, notation: notation } );

      }

    }

    return out.map( move => move.notation );

  }

  function debugLog( text ) {

    if ( typeof global !== 'undefined' && global.__TUTORIAL_DEBUG ) console.log( text );

  }

  function solveVirtual( start ) {

    let state = start;
    const stages = [];
    const startedAt = Date.now();

    function addStage( stageIndex, input, colors ) {

      if ( ! input || ! input.length ) return true;

      const raw = ( typeof input[ 0 ] === 'string' ) ? input : flattenMacros( input );
      const moves = simplifyMoves( raw );

      if ( ! moves.length ) return true;

      const steps = [];

      for ( const notation of moves ) {

        state = applyNotation( state, notation );

        steps.push( {
          notation: notation,
          colors: colors || null,
        } );

      }

      stages.push( {
        index: stageIndex,
        key: STAGES[ stageIndex ].key,
        name: STAGES[ stageIndex ].name,
        description: STAGES[ stageIndex ].description,
        moves: steps,
      } );

      return true;

    }

    // 1. White cross. The BFS returns plain face moves.
    const crossMoves = solveCross( state );

    if ( ! crossMoves ) return null;

    if ( crossMoves.length ) {

      const steps = [];
      let before = state;

      for ( const notation of crossMoves ) {

        const after = applyNotation( state, notation );
        const newly = D_EDGES.filter( p => ! isSlotSolved( state, p ) && isSlotSolved( after, p ) );
        const colors = newly.length ? SLOT_COLORS[ keyOf( newly[ 0 ] ) ] : null;

        state = after;
        steps.push( { notation: notation, colors: colors } );

      }

      stages.push( {
        index: 0,
        key: STAGES[ 0 ].key,
        name: STAGES[ 0 ].name,
        description: STAGES[ 0 ].description,
        moves: steps,
      } );

    }

    debugLog( 'cross: ' + ( Date.now() - startedAt ) + 'ms' );

    // 2. White corners.
    const solvedCorners = [];

    for ( const target of D_CORNERS ) {

      if ( isSlotSolved( state, target ) && isCross( state ) && solvedCorners.every( p => isSlotSolved( state, p ) ) ) {

        solvedCorners.push( target );
        continue;

      }

      const path = solveCorner( state, target );
      if ( ! path ) {
        debugLog( 'corner fail ' + keyOf( target ) + ' at ' + ( Date.now() - startedAt ) + 'ms' );
        return null;
      }

      const colors = SLOT_COLORS[ keyOf( target ) ];

      if ( ! addStage( 1, path, colors ) ) return null;

      solvedCorners.push( target );

      if ( ! isCross( state ) || ! solvedCorners.every( p => isSlotSolved( state, p ) ) ) return null;
      debugLog( 'corner ' + keyOf( target ) + ': ' + ( Date.now() - startedAt ) + 'ms' );

    }

    // 3. Middle layer.
    const solvedMiddle = [];

    for ( const target of MID_EDGES ) {

      if ( isSlotSolved( state, target ) && isDLayer( state ) && solvedMiddle.every( p => isSlotSolved( state, p ) ) ) {

        solvedMiddle.push( target );
        continue;

      }

      const path = solveMiddleEdge( state, target, solvedMiddle );
      if ( ! path ) {
        debugLog( 'middle fail ' + keyOf( target ) + ' D=' + isDLayer( state ) + ' at ' + ( Date.now() - startedAt ) + 'ms' );
        return null;
      }

      const colors = SLOT_COLORS[ keyOf( target ) ];

      if ( ! addStage( 2, path, colors ) ) return null;

      solvedMiddle.push( target );

      if ( ! isDLayer( state ) || ! solvedMiddle.every( p => isSlotSolved( state, p ) ) ) {
        debugLog( 'middle post fail ' + keyOf( target ) + ' D=' + isDLayer( state ) );
        return null;
      }
      debugLog( 'middle ' + keyOf( target ) + ': ' + ( Date.now() - startedAt ) + 'ms' );

    }

    // 4. Yellow cross.
    const oll = solveYellowCross( state );
    if ( ! oll ) {
      debugLog( 'oll fail at ' + ( Date.now() - startedAt ) + 'ms' );
      return null;
    }
    addStage( 3, oll, null );
    debugLog( 'oll: ' + ( Date.now() - startedAt ) + 'ms' );
    debugLog( 'oll after: middle=' + isMiddle( state ) + ' oriented=' + uEdgesOriented( state ) );

    // 5. Yellow edges.
    if ( typeof global !== 'undefined' ) global.__TUTORIAL_STAGE5 = state.slice();
    debugLog( 'edges start: middle=' + isMiddle( state ) + ' solved=' + uEdgesSolved( state ) + ' key=' + uEdgeKey( state ) + ' target=' + U_EDGE_TARGET );
    const edges = solveYellowEdges( state );
    if ( ! edges ) {
      debugLog( 'edges fail at ' + ( Date.now() - startedAt ) + 'ms' );
      return null;
    }
    addStage( 4, edges, null );
    debugLog( 'edges: ' + ( Date.now() - startedAt ) + 'ms' );

    // 6. Yellow corners.
    if ( typeof global !== 'undefined' ) global.__TUTORIAL_STAGE6 = state.slice();
    debugLog( 'corners start: middle=' + isMiddle( state ) + ' edges=' + uEdgesSolved( state ) + ' placed=' + uCornersPlaced( state ) );
    const corners = solveYellowCorners( state );
    if ( ! corners ) return null;
    addStage( 5, corners, null );
    debugLog( 'corner perm: ' + ( Date.now() - startedAt ) + 'ms' );

    // 7. Final orientation.
    if ( typeof global !== 'undefined' ) global.__TUTORIAL_STAGE7 = state.slice();
    const final = solveFinalOrientation( state );
    if ( ! final ) {
      debugLog( 'final fail at ' + ( Date.now() - startedAt ) + 'ms' );
      return null;
    }
    addStage( 6, final, null );
    debugLog( 'final: ' + ( Date.now() - startedAt ) + 'ms' );

    if ( ! isVirtualSolved( state ) ) return null;

    return stages;

  }

  function solveReal( realState, options ) {

    options = options || {};

    const virtual = rotateX180( realState );
    const stages = solveVirtual( virtual );

    if ( ! stages ) return null;

    // One corner (or middle edge) produces its own little stage entry. Merge
    // consecutive entries with the same key so the panel shows seven stages,
    // not one stage per piece.
    const merged = [];

    for ( const stage of stages ) {

      const last = merged[ merged.length - 1 ];

      if ( last && last.key === stage.key ) last.moves = last.moves.concat( stage.moves );
      else merged.push( {
        index: stage.index,
        key: stage.key,
        name: stage.name,
        description: stage.description,
        moves: stage.moves.slice(),
      } );

    }

    // Convert every virtual move to the game's real faces.
    return merged.map( stage => ( {
      index: stage.index,
      key: stage.key,
      name: stage.name,
      description: stage.description,
      moves: stage.moves.map( move => ( {
        notation: VIRTUAL_TO_REAL[ move.notation[ 0 ] ] + move.notation.slice( 1 ),
        virtual: move.notation,
        colors: move.colors || null,
      } ) ),
    } ) );

  }

  function solve( realState ) {

    const stages = solveReal( realState );

    if ( ! stages ) return null;

    const steps = [];

    for ( const stage of stages ) {

      for ( const move of stage.moves ) {

        steps.push( {
          notation: move.notation,
          colors: move.colors || null,
          stageIndex: stage.index,
          stageName: stage.name,
          stageDescription: stage.description,
        } );

      }

    }

    return { stages: stages, steps: steps };

  }

  // -------------------------------------------------------------------------
  // Move recognition for input validation.
  // -------------------------------------------------------------------------

  function identifyMove( before, after ) {

    for ( const move of MOVES ) {

      const next = applyPerm( before, move.perm );
      let same = true;

      for ( let i = 0; i < 54; i++ ) {

        if ( next[ i ] !== after[ i ] ) { same = false; break; }

      }

      if ( same ) return move.notation;

    }

    return null;

  }

  // -------------------------------------------------------------------------
  // Exports.
  // -------------------------------------------------------------------------

  return {
    FACES: FACES,
    STAGES: STAGES,
    solvedReal: solvedReal,
    solvedVirtual: solvedVirtual,
    rotateX180: rotateX180,
    stateFromStickers: stateFromStickers,
    stateToStickers: stateToStickers,
    applyNotation: applyNotation,
    applySequence: applySequence,
    applyMove: applyMove,
    invertNotation: invertNotation,
    identifyMove: identifyMove,
    isRealSolved: isRealSolved,
    isVirtualSolved: isVirtualSolved,
    isCross: isCross,
    isMiddle: isMiddle,
    uEdgesOriented: uEdgesOriented,
    uCornersOriented: uCornersOriented,
    solve: solve,
    solveVirtual: solveVirtual,
    // debug helpers
    _hidden: {
      moveTable: MOVE_BY_NOTATION,
      solveCross: solveCross,
      crossKey: crossKey,
      isSlotSolved: isSlotSolved,
      isDLayer: isDLayer,
      solveMiddleEdge: solveMiddleEdge,
      solveYellowCross: solveYellowCross,
      solveYellowEdges: solveYellowEdges,
      solveYellowCorners: solveYellowCorners,
      solveFinalOrientation: solveFinalOrientation,
      compose: compose,
      applyPerm: applyPerm,
      OLL: OLL_EDGE,
      T: T_PERM,
      A: A_PERM,
      isMiddle: isMiddle,
      uEdgesSolved: uEdgesSolved,
      uCornersPlaced: uCornersPlaced,
      uCornersOriented: uCornersOriented,
      colorsAt: colorsAt,
      uEdgeKey: uEdgeKey,
      U_EDGE_TARGET: U_EDGE_TARGET,
      uCornerKey: uCornerKey,
      uEdgesOriented: uEdgesOriented,
      U_CORNER_TARGET: U_CORNER_TARGET,
      dCorners: D_CORNERS,
      dEdges: D_EDGES,
      midEdges: MID_EDGES,
      uEdges: U_EDGES,
      uCorners: U_CORNERS,
      center: CENTER,
      faceOf: FACE_OF,
      slotColors: SLOT_COLORS,
    },
  };

} );
