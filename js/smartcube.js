// Bluetooth smart cube: mirrors a real cube's turns onto the game cube.
//
// The bundled library (vendor/smartcube) speaks the vendor protocols and emits
// one event per quarter turn plus the cube's current facelets. This class turns
// those events into the same layer rotations the mouse and hand controls use,
// and can copy the cube's facelets onto the game cube so the screen matches the
// real cube.
//
// The game's palette is the standard URFDLB frame yawed a quarter turn about
// white: its front face is red and its right face is blue (js/themes.js). A
// physical red face therefore maps to the game's F face, green to L, blue to R
// and orange to B. Both stickers and turns use that mapping, so a clockwise
// turn stays clockwise.

const STICKER_TO_GAME = { U: 'U', D: 'D', R: 'F', F: 'L', B: 'R', L: 'B' };

const GAME_FACE_VECTOR = {
  U: new THREE.Vector3( 0, 1, 0 ),
  D: new THREE.Vector3( 0, -1, 0 ),
  R: new THREE.Vector3( 1, 0, 0 ),
  L: new THREE.Vector3( -1, 0, 0 ),
  F: new THREE.Vector3( 0, 0, 1 ),
  B: new THREE.Vector3( 0, 0, -1 ),
};

// Clockwise quarter turn seen from outside the face, in the game's cube-local
// coordinates: the axes controls.keyboardMove expects.
const FACE_TURN = {
  U: { axis: 'y', index: 1, angle: -Math.PI / 2 },
  D: { axis: 'y', index: -1, angle: Math.PI / 2 },
  R: { axis: 'x', index: 1, angle: -Math.PI / 2 },
  L: { axis: 'x', index: -1, angle: Math.PI / 2 },
  F: { axis: 'z', index: 1, angle: -Math.PI / 2 },
  B: { axis: 'z', index: -1, angle: Math.PI / 2 },
};

// Centre of the sticker at row/column of a face in standard URFDLB order.
function faceletPosition( face, row, col ) {

  switch ( face ) {

    case 'U': return { x: -1 + col, y: 1, z: -1 + row };
    case 'R': return { x: 1, y: 1 - row, z: 1 - col };
    case 'F': return { x: -1 + col, y: 1 - row, z: 1 };
    case 'D': return { x: -1 + col, y: -1, z: 1 - row };
    case 'L': return { x: -1, y: 1 - row, z: -1 + col };
    case 'B': return { x: 1 - col, y: 1 - row, z: -1 };

  }

  return null;

}

class SmartCubeMode {

  constructor( game ) {

    this.game = game;

    this.supported = typeof navigator !== 'undefined' && !! navigator.bluetooth;

    this.connection = null;
    this.subscription = null;
    this.connecting = false;
    this.playing = false;
    this.open = false;

    this.queue = [];
    this.deferred = [];
    this.queueTimer = null;

    this.awaitingSync = false;
    this.pendingFacelets = null;
    this.syncTimer = null;

    this.askMac = false;
    this.battery = null;

    this.dom = {
      toggle: document.querySelector( '.smartcube__toggle' ),
      panel: document.querySelector( '.smartcube' ),
      device: document.querySelector( '.smartcube__device' ),
      battery: document.querySelector( '.smartcube__battery' ),
      status: document.querySelector( '.smartcube__status' ),
      connect: document.querySelector( '.smartcube__connect' ),
      sync: document.querySelector( '.smartcube__sync' ),
      disconnect: document.querySelector( '.smartcube__disconnect' ),
      all: document.querySelector( '.smartcube__all' ),
    };

    this.bindUi();
    this.setPlaying( false );

    if ( ! this.supported && this.dom.panel ) {

      this.dom.panel.hidden = true;
      this.status( 'Web Bluetooth needs Chrome or Edge on desktop or Android.', 'error' );

    }

  }

  bindUi() {

    if ( this.dom.toggle ) {

      this.dom.toggle.addEventListener( 'click', event => {

        event.stopPropagation();
        this.togglePanel();

      }, false );

    }

    if ( this.dom.connect ) {

      this.dom.connect.addEventListener( 'click', event => {

        event.stopPropagation();
        this.connect( false );

      }, false );

    }

    if ( this.dom.all ) {

      this.dom.all.addEventListener( 'click', event => {

        event.stopPropagation();
        this.connect( true );

      }, false );

    }

    if ( this.dom.sync ) {

      this.dom.sync.addEventListener( 'click', event => {

        event.stopPropagation();
        this.requestSync( true );

      }, false );

    }

    if ( this.dom.disconnect ) {

      this.dom.disconnect.addEventListener( 'click', event => {

        event.stopPropagation();
        this.disconnect();

      }, false );

    }

    window.addEventListener( 'keydown', event => {

      if ( event.repeat ) return;
      if ( event.key !== 'b' && event.key !== 'B' ) return;
      if ( this.game.state !== STATE.Playing ) return;

      this.togglePanel();

    }, false );

  }

  // The controls only exist during a game, so the toggle follows the same rule
  // as the camera button. The connection itself survives between games.
  setPlaying( playing ) {

    this.playing = playing;

    if ( this.dom.toggle ) this.dom.toggle.hidden = ! playing || ! this.supported;

    if ( ! playing ) {

      this.closePanel();
      this.queue = [];
      this.deferred = [];
      this.clearQueueTimer();

    }

  }

  togglePanel() {

    if ( this.open ) this.closePanel();
    else this.openPanel();

  }

  openPanel() {

    if ( ! this.dom.panel ) return;

    this.open = true;
    this.dom.panel.hidden = false;

    if ( this.dom.toggle ) {

      this.dom.toggle.classList.add( 'is-active' );
      this.dom.toggle.setAttribute( 'aria-expanded', 'true' );

    }

  }

  closePanel() {

    if ( ! this.dom.panel ) return;

    this.open = false;
    this.dom.panel.hidden = true;

    if ( this.dom.toggle ) {

      this.dom.toggle.classList.remove( 'is-active' );
      this.dom.toggle.setAttribute( 'aria-expanded', 'false' );

    }

  }

  status( text, tone ) {

    if ( ! this.dom.status ) return;

    this.dom.status.textContent = text;
    this.dom.status.dataset.tone = tone || '';

  }

  // --- Connection -------------------------------------------------------

  async connect( anyDevice ) {

    if ( this.connecting || this.connection ) return;

    if ( ! this.supported || typeof SmartCube === 'undefined' ) {

      this.status( 'Web Bluetooth is not available in this browser.', 'error' );
      return;

    }

    this.connecting = true;
    this.askMac = false;

    this.status( anyDevice ? 'Showing every Bluetooth device…' : 'Choose your cube in the browser dialog…' );

    try {

      const connection = await SmartCube.connectSmartCube( {
        deviceSelection: anyDevice ? 'any' : 'filtered',
        enableAddressSearch: true,
        onStatus: message => this.status( message ),
        macAddressProvider: () => this.macAddress(),
      } );

      this.attach( connection );

    } catch ( error ) {

      this.connecting = false;

      if ( error && ( error.name === 'NotFoundError' || error.name === 'AbortError' ) ) {

        this.status( 'No cube selected.' );
        return;

      }

      this.status( error && error.message ? error.message : 'Could not connect to the cube.', 'error' );

    }

  }

  // The library asks twice: once before it tries the advertisements and the
  // name, and once as a last resort. Only the second call prompts, so a cube
  // whose address it can work out never asks.
  macAddress() {

    if ( ! this.askMac ) {

      this.askMac = true;
      return null;

    }

    // Chrome does not expose a device's Bluetooth address to the page, so the
    // library has to be told. The WCU CUBE app shows it, and Chrome's own
    // Bluetooth internals page lists it under "Address".
    const value = window.prompt( 'MAC address of your cube (AA:BB:CC:DD:EE:FF).\n\nWhere to find it:\n• WCU CUBE app: open your cube\'s info / settings screen\n• Chrome: chrome://bluetooth-internals/#devices, see the Address column\n• The cube\'s box or battery compartment' );

    if ( ! value ) return null;

    const digits = value.trim().toUpperCase().replace( /[^0-9A-F]/g, '' );

    if ( digits.length !== 12 ) {

      window.alert( 'That is not a MAC address. Enter all six pairs, for example AA:BB:CC:DD:EE:FF.' );
      return null;

    }

    return digits.match( /../g ).join( ':' );

  }

  attach( connection ) {

    this.connecting = false;
    this.connection = connection;
    this.battery = null;

    const protocol = connection.protocol && connection.protocol.name ? ' · ' + connection.protocol.name : '';
    const name = connection.deviceName || 'Smart cube';

    if ( this.dom.device ) this.dom.device.textContent = name + protocol;
    if ( this.dom.battery ) this.dom.battery.hidden = true;
    if ( this.dom.connect ) this.dom.connect.hidden = true;
    if ( this.dom.all ) this.dom.all.hidden = true;
    if ( this.dom.sync ) this.dom.sync.hidden = false;
    if ( this.dom.disconnect ) this.dom.disconnect.hidden = false;

    this.subscription = connection.events$.subscribe( {
      next: event => this.onEvent( event ),
      error: () => this.detach( 'The cube connection ended. Reconnect to keep going.' ),
      complete: () => this.detach( 'The cube connection ended. Reconnect to keep going.' ),
    } );

    this.openPanel();
    this.requestSync( false );

  }

  onEvent( event ) {

    if ( ! event ) return;

    if ( event.type === 'MOVE' ) this.mirror( event.move );
    else if ( event.type === 'FACELETS' ) this.receiveFacelets( event.facelets );
    else if ( event.type === 'BATTERY' ) this.showBattery( event.batteryLevel );
    else if ( event.type === 'DISCONNECT' ) this.detach( 'The cube disconnected.' );

  }

  showBattery( level ) {

    if ( this.dom.battery ) {

      this.dom.battery.hidden = false;
      this.dom.battery.textContent = Math.round( level ) + '%';

    }

  }

  disconnect() {

    const connection = this.connection;

    this.detach( 'Cube disconnected.' );

    if ( connection && connection.disconnect ) connection.disconnect().catch( () => {} );

  }

  detach( message ) {

    if ( this.subscription ) {

      try { this.subscription.unsubscribe(); } catch ( error ) {}
      this.subscription = null;

    }

    this.connection = null;
    this.connecting = false;

    this.queue = [];
    this.deferred = [];
    this.clearQueueTimer();

    this.awaitingSync = false;
    this.pendingFacelets = null;
    clearTimeout( this.syncTimer );
    this.syncTimer = null;

    if ( this.dom.device ) this.dom.device.textContent = 'No cube connected';
    if ( this.dom.battery ) this.dom.battery.hidden = true;
    if ( this.dom.connect ) this.dom.connect.hidden = false;
    if ( this.dom.all ) this.dom.all.hidden = false;
    if ( this.dom.sync ) this.dom.sync.hidden = true;
    if ( this.dom.disconnect ) this.dom.disconnect.hidden = true;

    this.status( message );

  }

  // --- Turns ------------------------------------------------------------

  mirror( move ) {

    if ( ! this.playing ) return;

    const turns = this.parseMove( move );
    if ( turns.length === 0 ) return;

    // A sync is reading the absolute state; turns that arrive meanwhile have to
    // wait for it, or they would be applied twice.
    if ( this.awaitingSync ) {

      this.deferred.push( ... turns );
      return;

    }

    this.queue.push( ... turns );
    this.pump();

  }

  parseMove( move ) {

    const match = /^([URFDLB])([2'])?$/.exec( String( move ).trim() );
    if ( ! match ) return [];

    const face = STICKER_TO_GAME[ match[ 1 ] ];
    const turn = FACE_TURN[ face ];
    if ( ! turn ) return [];

    const times = match[ 2 ] === '2' ? 2 : 1;
    const angle = match[ 2 ] === "'" ? - turn.angle : turn.angle;

    const turns = [];

    for ( let i = 0; i < times; i++ ) {

      turns.push( {
        axis: turn.axis,
        index: turn.index,
        angle: angle,
      } );

    }

    return turns;

  }

  pump() {

    if ( this.queueTimer ) return;

    const step = () => {

      this.queueTimer = null;

      if ( ! this.playing || this.awaitingSync ) return;
      if ( ! this.connection || this.queue.length === 0 ) return;

      const controls = this.game.controls;

      if ( ! controls || controls.enabled !== true || controls.state !== STILL ) {

        this.queueTimer = setTimeout( step, 80 );
        return;

      }

      const turn = this.queue.shift();

      controls.keyboardMove( 'LAYER', {
        axis: turn.axis,
        position: { [ turn.axis ]: turn.index },
        angle: turn.angle,
      } );

      if ( this.queue.length > 0 ) this.queueTimer = setTimeout( step, 90 );

    };

    this.queueTimer = setTimeout( step, 0 );

  }

  clearQueueTimer() {

    if ( this.queueTimer ) clearTimeout( this.queueTimer );
    this.queueTimer = null;

  }

  // --- State sync -------------------------------------------------------

  requestSync( manual ) {

    if ( ! this.connection ) return;

    const capabilities = this.connection.capabilities || {};

    if ( ! capabilities.facelets ) {

      if ( manual ) this.status( 'This cube cannot report its position. Turns are still mirrored.' );
      return;

    }

    this.awaitingSync = true;

    clearTimeout( this.syncTimer );

    this.syncTimer = setTimeout( () => {

      this.awaitingSync = false;
      this.syncTimer = null;
      this.pendingFacelets = null;
      this.flushDeferred();
      this.status( 'The cube did not send its position. Turn a face and press Sync again.', 'error' );

    }, 5000 );

    if ( manual ) this.status( 'Reading the cube…' );

    this.connection.sendCommand( { type: 'REQUEST_FACELETS' } ).catch( () => {} );

  }

  receiveFacelets( facelets ) {

    if ( ! this.awaitingSync ) return;
    if ( typeof facelets !== 'string' ) return;

    this.pendingFacelets = facelets;
    this.applyPendingFacelets( 0 );

  }

  applyPendingFacelets( attempt ) {

    if ( ! this.awaitingSync || ! this.pendingFacelets ) return;

    const controls = this.game.controls;

    if ( controls && controls.enabled === true && controls.state !== STILL && attempt < 50 ) {

      setTimeout( () => this.applyPendingFacelets( attempt + 1 ), 100 );
      return;

    }

    const facelets = this.pendingFacelets;
    this.pendingFacelets = null;

    clearTimeout( this.syncTimer );
    this.syncTimer = null;
    this.awaitingSync = false;

    if ( this.applyFacelets( facelets ) ) {

      this.status( 'Your cube is on screen. Turn it to play.' );
      if ( this.game.tutorial ) this.game.tutorial.onCubeReplaced();

    } else {

      this.status( 'That cube position did not match a 3×3×3. Set Cube Size to 3×3×3 and press Sync.', 'error' );

    }

    this.flushDeferred();

  }

  flushDeferred() {

    if ( this.deferred.length > 0 ) {

      this.queue.push( ... this.deferred );
      this.deferred = [];
      this.pump();

    }

  }

  // Copies a standard URFDLB facelet string onto the game cube.
  //
  // Every visible cubie is found from the set of sticker colours on it, then
  // rotated so each sticker points at the face it now sits on. The game's own
  // axes are the physical ones yawed a quarter turn (see the tables above).
  applyFacelets( facelets ) {

    const cube = this.game.cube;

    if ( ! cube || ! cube.pieces || cube.size !== 3 ) return false;
    if ( typeof facelets !== 'string' || facelets.length !== 54 ) return false;

    const stickers = new Map();

    for ( let face = 0; face < 6; face++ ) {

      const letter = 'URFDLB'[ face ];

      for ( let index = 0; index < 9; index++ ) {

        const row = Math.floor( index / 3 );
        const col = index % 3;
        const std = faceletPosition( letter, row, col );

        if ( ! std ) return false;

        // Physical coordinates to the game's: red faces the player, so the
        // standard frame is yawed a quarter turn about white.
        const position = { x: - std.z, y: std.y, z: std.x };
        const key = position.x + ',' + position.y + ',' + position.z;

        const color = facelets[ face * 9 + index ];
        const name = STICKER_TO_GAME[ color ];

        if ( ! name ) return false;

        // The sticker's current face is the standard face turned into the
        // game's frame. Three stickers share a position, so this cannot be
        // read from the position alone.
        const gameFace = STICKER_TO_GAME[ letter ];

        if ( ! stickers.has( key ) ) stickers.set( key, [] );
        stickers.get( key ).push( { name: name, face: gameFace } );

      }

    }

    const placements = [];

    for ( const [ key, list ] of stickers ) {

      const [ x, y, z ] = key.split( ',' ).map( Number );

      if ( x === 0 && y === 0 && z === 0 ) continue;

      const names = list.map( sticker => sticker.name ).sort().join( '' );

      const piece = cube.pieces.find( candidate => {

        const own = candidate.userData.edges.slice().sort().join( '' );
        return own === names;

      } );

      if ( ! piece ) return false;

      // Which face each of this piece's stickers now sits on.
      const targets = {};

      list.forEach( sticker => targets[ sticker.name ] = GAME_FACE_VECTOR[ sticker.face ] );

      const sides = piece.userData.edges;

      // Centres carry one sticker and have no visible orientation.
      let rotation = new THREE.Quaternion();

      if ( sides.length > 1 ) {

        const first = sides[ 0 ];
        const second = sides[ 1 ];

        const localFirst = GAME_FACE_VECTOR[ first ];
        const localSecond = GAME_FACE_VECTOR[ second ];
        const targetFirst = targets[ first ];
        const targetSecond = targets[ second ];

        if ( ! targetFirst || ! targetSecond ) return false;

        const localBasis = new THREE.Matrix4().makeBasis(
          localFirst,
          localSecond,
          localFirst.clone().cross( localSecond )
        );

        const targetBasis = new THREE.Matrix4().makeBasis(
          targetFirst,
          targetSecond,
          targetFirst.clone().cross( targetSecond )
        );

        rotation = new THREE.Quaternion().setFromRotationMatrix(
          targetBasis.multiply( new THREE.Matrix4().getInverse( localBasis ) )
        );

      }

      placements.push( {
        piece: piece,
        position: new THREE.Vector3( x, y, z ).divideScalar( 3 ),
        rotation: rotation,
      } );

    }

    if ( placements.length !== 26 ) return false;

    placements.forEach( placement => {

      placement.piece.position.copy( placement.position );
      placement.piece.quaternion.copy( placement.rotation );
      placement.piece.updateMatrix();

    } );

    cube.holder.updateMatrixWorld( true );

    if ( this.playing ) {

      try { this.game.storage.saveGame(); } catch ( error ) {}

    }

    return true;

  }

}
