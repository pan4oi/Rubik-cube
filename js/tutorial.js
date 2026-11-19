// Interactive beginner-method tutorial.
//
// The solver (tutorial-solver.js) works on facelets. This class is the bridge
// to the game: it reads the current cubies, validates the player's turns
// against the expected next state, drives the tutorial panel, and draws the
// layer highlight plus the curved turn arrow in the three.js scene.

class TutorialMode {

  constructor( game ) {

    this.game = game;

    this.active = false;
    this.loading = false;
    this.pendingStart = false;
    this.autoRunning = false;
    this.flipping = false;
    this.viewFlipped = false;

    this.solution = null;
    this.steps = [];
    this.stages = [];
    this.expected = [];
    this.index = 0;
    this.currentState = null;
    this.deviations = [];
    this.indicatorStep = null;

    this.retryTimer = null;
    this.checkTimer = null;
    this.flipTween = null;
    this.flipFrom = null;
    this.flipTarget = null;
    this.flipToFlipped = false;
    this.pendingFlip = null;
    this.solveTimer = null;

    this.dom = {
      toggle: document.querySelector( '.tutorial__toggle' ),
      panel: document.querySelector( '.tutorial' ),
      stage: document.querySelector( '.tutorial__stage' ),
      count: document.querySelector( '.tutorial__count' ),
      move: document.querySelector( '.tutorial__move b' ),
      moveName: document.querySelector( '.tutorial__move span' ),
      note: document.querySelector( '.tutorial__note' ),
      status: document.querySelector( '.tutorial__status' ),
      prev: document.querySelector( '.tutorial__prev' ),
      auto: document.querySelector( '.tutorial__auto' ),
      exit: document.querySelector( '.tutorial__exit' ),
      dots: Array.from( document.querySelectorAll( '.tutorial__dots i' ) ),
    };

    this.colors = this.readCenterColors();
    this.indicator = new TutorialIndicator( this );

    this.bindUi();
    this.setPlaying( false );

    // Game.initActions() installs the timer callback. Wrap it instead of
    // replacing it, so starting the timer and validating a tutorial turn both
    // happen. A user turn fires onMove before the layer is deselected, so the
    // state is read on the next task.
    const previousOnMove = this.game.controls.onMove;

    this.game.controls.onMove = () => {

      if ( typeof previousOnMove === 'function' ) previousOnMove();
      if ( this.active && ! this.autoRunning ) this.scheduleCheck();

    };

    window.addEventListener( 'keydown', event => {

      if ( event.repeat ) return;

      if ( ( event.key === 't' || event.key === 'T' ) && this.game.state === STATE.Playing ) {

        this.toggle();

      } else if ( event.key === 'Escape' && this.active ) {

        this.exit();

      }

    }, false );

  }

  bindUi() {

    if ( this.dom.toggle ) {

      this.dom.toggle.addEventListener( 'click', event => {

        event.stopPropagation();
        this.toggle();

      }, false );

    }

    if ( this.dom.prev ) {

      this.dom.prev.addEventListener( 'click', event => {

        event.stopPropagation();
        this.previous();

      }, false );

    }

    if ( this.dom.auto ) {

      this.dom.auto.addEventListener( 'click', event => {

        event.stopPropagation();
        this.auto();

      }, false );

    }

    if ( this.dom.exit ) {

      this.dom.exit.addEventListener( 'click', event => {

        event.stopPropagation();
        this.exit();

      }, false );

    }

  }

  setPlaying( playing ) {

    if ( this.dom.toggle ) this.dom.toggle.hidden = ! playing;

    if ( ! playing ) this.exit();

  }

  toggle() {

    if ( this.active || this.loading || this.pendingStart ) this.exit();
    else this.begin();

  }

  begin() {

    if ( this.game.state !== STATE.Playing ) return;

    if ( this.game.cube.size !== 3 ) {

      this.openPanel();
      this.active = true;
      this.loading = false;
      this.steps = [];
      this.stages = [];
      this.renderMessage(
        'Tutorial unavailable',
        'This step-by-step tutorial solves a 3x3x3 cube. Set Cube Size to 3x3x3 in the preferences and start a new game.'
      );
      return;

    }

    if ( this.game.controls.scramble !== null || ! this.game.controls.enabled || this.game.controls.state !== STILL ) {

      this.pendingStart = true;
      this.active = true;
      this.loading = true;
      this.openPanel();
      this.renderMessage( 'Get ready', 'Wait for the scramble to finish…' );

      clearTimeout( this.retryTimer );
      this.retryTimer = setTimeout( () => {

        if ( this.pendingStart ) this.begin();

      }, 350 );

      return;

    }

    this.pendingStart = false;
    this.colors = this.readCenterColors();
    this.openPanel();
    this.active = true;
    this.loading = true;
    this.solution = null;
    this.steps = [];
    this.stages = [];
    this.expected = [];
    this.index = 0;
    this.deviations = [];
    this.currentState = this.readState();
    this.indicator.clear();

    this.renderMessage( 'Reading your cube', 'Working out a layer-by-layer solution…' );

    clearTimeout( this.solveTimer );
    this.solveTimer = setTimeout( () => this.solveCurrent(), 30 );

  }

  solveCurrent() {

    if ( ! this.active ) return;

    const state = this.readState();

    if ( ! state ) {

      this.loading = false;
      this.renderMessage( 'Cannot read the cube', 'Wait for the cube to settle, then try again.' );
      return;

    }

    const solution = TutorialSolver.solve( state );

    if ( ! solution ) {

      this.loading = false;
      this.renderMessage(
        'No solution found',
        'That position could not be solved. Press Exit, scramble the cube again, and retry.'
      );
      return;

    }

    this.solution = solution;
    this.steps = solution.steps;
    this.stages = solution.stages;
    this.currentState = state;

    let expectedState = state;
    this.expected = [ expectedState ];

    for ( const step of this.steps ) {

      expectedState = TutorialSolver.applyNotation( expectedState, step.notation );
      this.expected.push( expectedState );

    }

    this.loading = false;
    this.index = 0;
    this.deviations = [];
    this.clearStatus();

    if ( ! this.steps.length ) {

      this.renderMessage( 'Already solved', 'This cube is already solved. Scramble it to start a new tutorial.' );
      return;

    }

    this.render();

  }

  render() {

    if ( ! this.active ) return;

    if ( this.index >= this.steps.length ) {

      this.indicatorStep = null;
      this.indicator.clear();
      this.dom.stage.textContent = 'Tutorial complete';
      this.dom.count.textContent = this.steps.length + ' moves';
      this.dom.move.textContent = '✓';
      this.dom.moveName.textContent = 'Cube solved';
      this.dom.note.textContent = 'You finished the beginner method. Press Exit and try a new scramble, or use Previous to step back.';
      this.setDots( 7 );
      this.dom.auto.disabled = true;
      this.dom.prev.disabled = false;
      return;

    }

    const step = this.steps[ this.index ];
    const stage = TutorialSolver.STAGES[ step.stageIndex ] || this.stages[ 0 ];

    this.dom.stage.textContent = stage.name;
    this.dom.count.textContent = 'Stage ' + ( step.stageIndex + 1 ) + ' of 7 · Step ' + ( this.index + 1 ) + ' of ' + this.steps.length;
    this.dom.move.textContent = step.notation;
    this.dom.moveName.textContent = this.moveWords( step.notation );
    this.dom.note.textContent = this.why( step );

    this.setDots( step.stageIndex );
    this.updateButtons();
    this.status( 'Do the highlighted turn on the cube.', '' );

    this.indicatorStep = step;
    this.indicator.show( step );
    this.setViewFlipped( step.stageIndex >= 3 );

  }

  renderRecovery() {

    if ( ! this.active || ! this.deviations.length ) return;

    const top = this.deviations[ this.deviations.length - 1 ];
    const step = this.steps[ this.index ];
    const stageIndex = step ? step.stageIndex : 0;

    this.dom.stage.textContent = 'Off track';
    this.dom.count.textContent = this.deviations.length + ' move' + ( this.deviations.length === 1 ? '' : 's' ) + ' to undo';
    this.dom.move.textContent = top.undo;
    this.dom.moveName.textContent = this.moveWords( top.undo );
    this.dom.note.textContent = 'That turn was not part of the solution. Undo it to get back on track.';

    this.setDots( stageIndex );
    this.updateButtons();
    this.status( 'Wrong turn — turn ' + top.undo + ' to undo it.', 'error' );

    this.indicatorStep = { notation: top.undo, stageIndex: stageIndex, colors: null };
    this.indicator.show( this.indicatorStep );
    this.setViewFlipped( stageIndex >= 3 );

  }

  renderMessage( title, text ) {

    if ( ! this.active ) return;

    this.indicatorStep = null;
    this.indicator.clear();
    this.dom.stage.textContent = title;
    this.dom.count.textContent = 'Tutorial';
    this.dom.move.textContent = '?';
    this.dom.moveName.textContent = '';
    this.dom.note.textContent = text;
    this.setDots( - 1 );
    this.dom.auto.disabled = true;
    this.dom.prev.disabled = true;
    this.clearStatus();

  }

  setDots( activeIndex ) {

    this.dom.dots.forEach( ( dot, index ) => {

      dot.classList.toggle( 'is-done', index < activeIndex );
      dot.classList.toggle( 'is-active', index === activeIndex );

    } );

  }

  updateButtons() {

    const busy = this.autoRunning || this.loading || this.flipping;

    this.dom.prev.disabled = busy;
    this.dom.auto.disabled = busy;
    this.dom.exit.disabled = false;

  }

  status( text, tone ) {

    if ( ! this.dom.status ) return;

    this.dom.status.textContent = text || '';
    this.dom.status.dataset.tone = tone || '';

  }

  clearStatus() {

    this.status( '', '' );

  }

  openPanel() {

    if ( ! this.dom.panel ) return;

    this.dom.panel.hidden = false;

    if ( this.dom.toggle ) {

      this.dom.toggle.classList.add( 'is-active' );
      this.dom.toggle.setAttribute( 'aria-expanded', 'true' );

    }

    if ( this.game.smartcube ) this.game.smartcube.closePanel();

  }

  closePanel() {

    if ( ! this.dom.panel ) return;

    this.dom.panel.hidden = true;

    if ( this.dom.toggle ) {

      this.dom.toggle.classList.remove( 'is-active' );
      this.dom.toggle.setAttribute( 'aria-expanded', 'false' );

    }

  }

  exit() {

    this.pendingStart = false;
    this.loading = false;
    this.active = false;
    this.autoRunning = false;

    clearTimeout( this.retryTimer );
    clearTimeout( this.checkTimer );
    clearTimeout( this.solveTimer );

    this.steps = [];
    this.stages = [];
    this.expected = [];
    this.deviations = [];
    this.currentState = null;
    this.indicatorStep = null;

    this.indicator.clear();
    this.closePanel();
    this.clearStatus();
    this.pendingFlip = null;

    const wasFlipping = this.flipping;

    if ( this.flipTween ) {

      try { this.flipTween.stop(); } catch ( error ) {}
      this.flipTween = null;

    }

    this.flipping = false;

    const cube = this.game.cube;
    const controls = this.game.controls;
    const rotate = new THREE.Quaternion().setFromAxisAngle( new THREE.Vector3( 1, 0, 0 ), Math.PI );

    if ( wasFlipping && this.flipTarget ) {

      // The tween was interrupted. Finish it instantly, then undo the flip if
      // the interrupted tween was on its way to the flipped view.
      cube.object.quaternion.copy( this.flipTarget );
      if ( this.flipToFlipped ) cube.object.quaternion.premultiply( rotate );
      controls.edges.quaternion.copy( cube.object.quaternion );
      this.viewFlipped = false;

    } else if ( this.viewFlipped ) {

      cube.object.quaternion.premultiply( rotate );
      controls.edges.quaternion.copy( cube.object.quaternion );
      this.viewFlipped = false;

    }

    this.flipFrom = null;
    this.flipTarget = null;

  }

  // --- Reading and validating the cube ----------------------------------

  readState() {

    const cube = this.game.cube;

    if ( ! cube || cube.size !== 3 || ! Array.isArray( cube.pieces ) || cube.pieces.length < 26 ) return null;

    const stickers = [];

    try {

      cube.pieces.forEach( piece => {

        const pos = piece.position.clone().multiplyScalar( 3 ).round();
        if ( pos.length() < 0.5 ) return;

        piece.children.forEach( child => {

          if ( ! child.isMesh || ! child.name ) return;
          if ( [ 'L', 'R', 'D', 'U', 'B', 'F' ].indexOf( child.name ) < 0 ) return;

          const normal = child.position.clone().normalize().applyQuaternion( piece.quaternion ).round();

          stickers.push( {
            pos: [ Math.round( pos.x ), Math.round( pos.y ), Math.round( pos.z ) ],
            normal: [ Math.round( normal.x ), Math.round( normal.y ), Math.round( normal.z ) ],
            color: child.name,
          } );

        } );

      } );

    } catch ( error ) {

      return null;

    }

    if ( stickers.length !== 54 ) return null;

    try {

      return TutorialSolver.stateFromStickers( stickers );

    } catch ( error ) {

      return null;

    }

  }

  scheduleCheck() {

    clearTimeout( this.checkTimer );
    this.checkTimer = setTimeout( () => this.check(), 40 );

  }

  check() {

    if ( ! this.active || this.autoRunning || this.loading ) return;

    if ( this.flipping ) {

      this.scheduleCheck();
      return;

    }

    if ( this.game.controls.state !== STILL ) {

      this.scheduleCheck();
      return;

    }

    const current = this.readState();
    if ( ! current ) return;

    if ( this.deviations.length ) {

      const top = this.deviations[ this.deviations.length - 1 ];

      if ( this.sameState( current, top.before ) ) {

        this.deviations.pop();
        this.currentState = current;
        this.clearStatus();

        if ( this.deviations.length ) this.renderRecovery();
        else this.render();

        return;

      }

      const wrong = TutorialSolver.identifyMove( this.currentState, current );

      if ( wrong ) {

        this.deviations.push( {
          undo: TutorialSolver.invertNotation( wrong ),
          before: this.currentState,
          after: current,
        } );
        this.currentState = current;
        this.renderRecovery();
        return;

      }

      this.restartFromCurrent( 'The cube changed, so I recalculated the solution.' );
      return;

    }

    for ( let advance = 1; advance <= 3; advance++ ) {

      const target = this.expected[ this.index + advance ];

      if ( target && this.sameState( current, target ) ) {

        this.index += advance;
        this.currentState = current;
        this.clearStatus();
        this.render();
        return;

      }

    }

    if ( this.expected[ this.index ] && this.sameState( current, this.expected[ this.index ] ) ) {

      this.currentState = current;
      return;

    }

    // Turning a move back is a useful way to step backwards without treating
    // it as a mistake.
    if ( this.index > 0 && this.expected[ this.index - 1 ] && this.sameState( current, this.expected[ this.index - 1 ] ) ) {

      this.index--;
      this.currentState = current;
      this.clearStatus();
      this.render();
      return;

    }

    const wrong = TutorialSolver.identifyMove( this.currentState, current );

    if ( wrong ) {

      this.deviations.push( {
        undo: TutorialSolver.invertNotation( wrong ),
        before: this.currentState,
        after: current,
      } );
      this.currentState = current;
      this.renderRecovery();
      return;

    }

    this.restartFromCurrent( 'The cube changed, so I recalculated the solution.' );

  }

  sameState( a, b ) {

    if ( ! a || ! b || a.length !== b.length ) return false;

    for ( let i = 0; i < a.length; i++ ) if ( a[ i ] !== b[ i ] ) return false;

    return true;

  }

  restartFromCurrent( message ) {

    this.loading = true;
    this.indicator.clear();
    this.status( message, '' );
    this.deviations = [];
    this.index = 0;
    this.currentState = this.readState();

    clearTimeout( this.solveTimer );
    this.solveTimer = setTimeout( () => {

      this.loading = false;
      this.solveCurrent();

    }, 20 );

  }

  onCubeReplaced() {

    if ( ! this.active ) return;

    if ( this.autoRunning ) {

      setTimeout( () => this.onCubeReplaced(), 120 );
      return;

    }

    this.restartFromCurrent( 'The cube changed, so I recalculated the solution.' );

  }

  // --- Tutorial controls ------------------------------------------------

  previous() {

    if ( ! this.active || this.autoRunning || this.loading ) return;

    if ( this.deviations.length ) {

      const top = this.deviations[ this.deviations.length - 1 ];
      this.executeMove( top.undo, () => {

        this.deviations.pop();
        this.currentState = this.readState();
        if ( this.deviations.length ) this.renderRecovery();
        else this.render();

      } );

      return;

    }

    if ( this.index === 0 ) {

      this.status( 'You are at the first step.', '' );
      return;

    }

    if ( ! this.expected[ this.index ] || ! this.sameState( this.currentState, this.expected[ this.index ] ) ) {

      this.restartFromCurrent( 'Solution restarted from the current cube.' );
      return;

    }

    const undo = TutorialSolver.invertNotation( this.steps[ this.index - 1 ].notation );

    this.executeMove( undo, () => {

      this.index--;
      this.currentState = this.readState();
      this.clearStatus();
      this.render();

    } );

  }

  auto() {

    if ( ! this.active || this.autoRunning || this.loading || this.flipping ) return;

    if ( this.deviations.length ) {

      const top = this.deviations[ this.deviations.length - 1 ];
      this.executeMove( top.undo, () => {

        this.deviations.pop();
        this.currentState = this.readState();
        if ( this.deviations.length ) this.renderRecovery();
        else this.render();

      } );

      return;

    }

    if ( this.index >= this.steps.length ) return;

    const step = this.steps[ this.index ];

    this.executeMove( step.notation, () => {

      this.index++;
      this.currentState = this.readState();
      this.clearStatus();
      this.render();

    } );

  }

  executeMove( notation, callback ) {

    if ( this.autoRunning ) return;

    const controls = this.game.controls;

    if ( ! controls.enabled || controls.state !== STILL ) {

      setTimeout( () => {

        if ( this.active && ! this.autoRunning ) this.executeMove( notation, callback );

      }, 120 );

      return;

    }

    const params = this.moveParams( notation );
    if ( ! params ) return;

    this.autoRunning = true;
    this.updateButtons();

    controls.keyboardMove( 'LAYER', params, () => {

      this.autoRunning = false;

      if ( ! this.active ) return;

      if ( typeof callback === 'function' ) callback();

    } );

    // keyboardMove is a no-op when the controls are mid-animation. If that
    // happened, release the buttons instead of leaving them stuck disabled.
    setTimeout( () => {

      if ( ! this.active || ! this.autoRunning ) return;
      if ( controls.state === STILL ) {

        this.autoRunning = false;
        this.updateButtons();

      }

    }, 70 );

  }

  moveParams( notation ) {

    const face = notation[ 0 ];
    const modifier = notation[ 1 ];

    const config = {
      U: { axis: 'y', index: 1, angle: - Math.PI / 2 },
      D: { axis: 'y', index: - 1, angle: Math.PI / 2 },
      R: { axis: 'x', index: 1, angle: - Math.PI / 2 },
      L: { axis: 'x', index: - 1, angle: Math.PI / 2 },
      F: { axis: 'z', index: 1, angle: - Math.PI / 2 },
      B: { axis: 'z', index: - 1, angle: Math.PI / 2 },
    }[ face ];

    if ( ! config ) return null;

    let angle = config.angle;
    if ( modifier === "'" ) angle = - angle;
    if ( modifier === '2' ) angle = angle * 2;

    return {
      axis: config.axis,
      position: { [ config.axis ]: config.index },
      angle: angle,
    };

  }

  // --- Human-readable copy ---------------------------------------------

  readCenterColors() {

    const colors = {};
    const palette = {
      white: [ 255, 255, 255 ],
      yellow: [ 255, 239, 72 ],
      red: [ 239, 57, 35 ],
      orange: [ 255, 140, 10 ],
      green: [ 130, 202, 56 ],
      blue: [ 65, 170, 200 ],
    };

    const cube = this.game.cube;
    if ( ! cube || ! cube.pieces ) return {};

    cube.pieces.forEach( piece => {

      const pos = piece.position.clone().multiplyScalar( 3 ).round();
      const nonZero = ( pos.x !== 0 ? 1 : 0 ) + ( pos.y !== 0 ? 1 : 0 ) + ( pos.z !== 0 ? 1 : 0 );
      if ( nonZero !== 1 ) return;

      const edge = piece.children.find( child => child.isMesh && child.name );
      if ( ! edge ) return;

      const hex = edge.material.color.getHex();
      const rgb = [
        ( hex >> 16 ) & 255,
        ( hex >> 8 ) & 255,
        hex & 255,
      ];

      let best = null;
      let distance = Infinity;

      Object.keys( palette ).forEach( name => {

        const ref = palette[ name ];
        const d = Math.pow( rgb[ 0 ] - ref[ 0 ], 2 ) + Math.pow( rgb[ 1 ] - ref[ 1 ], 2 ) + Math.pow( rgb[ 2 ] - ref[ 2 ], 2 );

        if ( d < distance ) { distance = d; best = name; }

      } );

      colors[ edge.name ] = distance < 12000 ? best : null;

    } );

    return colors;

  }

  faceName( face ) {

    return {
      U: 'top',
      D: 'bottom',
      L: 'left',
      R: 'right',
      F: 'front',
      B: 'back',
    }[ face ] || face;

  }

  colorName( letter ) {

    return this.colors[ letter ] || {
      U: 'white',
      D: 'yellow',
      F: 'red',
      R: 'blue',
      B: 'orange',
      L: 'green',
    }[ letter ] || 'side';

  }

  pieceName( letters ) {

    if ( ! letters || ! letters.length ) return '';

    const order = { U: 0, D: 1, F: 2, R: 3, B: 4, L: 5 };
    const sorted = letters.slice().sort( ( a, b ) => order[ a ] - order[ b ] );

    return sorted.map( letter => this.colorName( letter ) ).join( '-' );

  }

  moveWords( notation ) {

    const face = notation[ 0 ];
    const modifier = notation[ 1 ];
    const color = this.colors[ face ];

    // Prefer the sticker colour over top/bottom/front/back. The tutorial flips
    // the view for the yellow stages, so a colour is unambiguous where a
    // spatial word would disagree with what is on screen.
    const label = color ? color + ' face' : this.faceName( face ) + ' face';

    if ( modifier === '2' ) return 'Turn the ' + label + ' a half turn';
    if ( modifier === "'" ) return 'Turn the ' + label + ' counter-clockwise';
    return 'Turn the ' + label + ' clockwise';

  }

  why( step ) {

    const piece = step.colors ? this.pieceName( step.colors ) : '';

    switch ( step.stageIndex ) {

      case 0:
        if ( ! piece ) return 'Move this edge toward the white cross without disturbing the pieces already placed.';
        return 'Bring the ' + piece + ' edge into the white cross. Its side colour should end up matching the centre.';

      case 1:
        if ( ! piece ) return 'Reposition the white corner; this trigger moves it closer to its slot.';
        return 'This inserts the ' + piece + ' corner into the white layer. Repeat the same turn if the corner is still twisted.';

      case 2:
        if ( ! piece ) return 'Reposition the edge before sliding it into the middle layer.';
        return 'This slides the ' + piece + ' edge into the middle layer without disturbing the white layer.';

      case 3:
        return 'Orient the yellow edges. Apply this pattern until they form a yellow cross.';

      case 4:
        return 'Cycle the yellow edges so each one matches its side centre. One edge may already be correct — keep it at the back.';

      case 5:
        return 'Move the yellow corners into their correct positions. After this, only their rotation is left.';

      case 6:
        return 'Twist this corner until yellow faces up. The cube will look scrambled until the very last corner — that is normal for this method.';

      default:
        return '';

    }

  }

  // --- View -------------------------------------------------------------

  setViewFlipped( flipped ) {

    if ( this.flipping ) {

      this.pendingFlip = flipped;
      return;

    }

    if ( this.viewFlipped === flipped ) return;

    const cube = this.game.cube;
    const controls = this.game.controls;

    const from = cube.object.quaternion.clone();
    const target = new THREE.Quaternion().setFromAxisAngle( new THREE.Vector3( 1, 0, 0 ), Math.PI ).multiply( from );

    this.flipFrom = from.clone();
    this.flipTarget = target.clone();
    this.flipToFlipped = flipped;
    this.viewFlipped = flipped;
    this.flipping = true;
    this.updateButtons();

    const id = ( this.flipId || 0 ) + 1;
    this.flipId = id;

    this.flipTween = new Tween( {
      duration: 480,
      easing: Easing.Power.Out( 2 ),
      onUpdate: tween => {

        if ( this.flipId !== id ) return;

        cube.object.quaternion.copy( from ).slerp( target, tween.value );
        controls.edges.quaternion.copy( cube.object.quaternion );

      },
      onComplete: () => {

        if ( this.flipId !== id ) return;

        cube.object.quaternion.copy( target );
        controls.edges.quaternion.copy( target );
        this.flipTween = null;
        this.flipFrom = null;
        this.flipTarget = null;
        this.flipping = false;
        this.updateButtons();

        // Rebuild the ring now that the cube is in its final view. On the
        // first yellow step the indicator was created before the flip, so its
        // arrowhead was chosen for the old orientation.
        if ( this.active && this.indicatorStep ) this.indicator.show( this.indicatorStep );

        if ( this.pendingFlip !== null ) {

          const next = this.pendingFlip;
          this.pendingFlip = null;
          if ( next !== this.viewFlipped ) this.setViewFlipped( next );

        }

      },
    } );

  }

}

// -------------------------------------------------------------------------
// 3D turn indicator: pulsing stickers + a curved arrow on the target face.
// -------------------------------------------------------------------------

class TutorialIndicator extends Animation {

  constructor( tutorial ) {

    super( true );

    this.tutorial = tutorial;
    this.game = tutorial.game;

    this.group = new THREE.Group();
    this.group.name = 'tutorial-indicator';

    this.glows = [];
    this.glowMaterial = null;
    this.arrowGroup = null;
    this.arrowMaterials = [];
    this.arrowGeometries = [];

  }

  attachGroup() {

    if ( this.group.parent !== this.game.cube.object ) {

      this.game.cube.object.add( this.group );

    }

  }

  clear() {

    this.glows.forEach( entry => {

      if ( entry.mesh.parent ) entry.mesh.parent.remove( entry.mesh );

    } );

    this.glows = [];

    if ( this.glowMaterial ) {

      this.glowMaterial.dispose();
      this.glowMaterial = null;

    }

    if ( this.arrowGroup ) {

      if ( this.arrowGroup.parent ) this.arrowGroup.parent.remove( this.arrowGroup );
      this.arrowGroup = null;

    }

    this.arrowMaterials.forEach( material => material.dispose() );
    this.arrowGeometries.forEach( geometry => geometry.dispose() );
    this.arrowMaterials = [];
    this.arrowGeometries = [];

  }

  show( step ) {

    this.clear();
    this.attachGroup();

    if ( ! step || ! step.notation ) return;

    const face = step.notation[ 0 ];
    const normal = {
      U: new THREE.Vector3( 0, 1, 0 ),
      D: new THREE.Vector3( 0, - 1, 0 ),
      R: new THREE.Vector3( 1, 0, 0 ),
      L: new THREE.Vector3( - 1, 0, 0 ),
      F: new THREE.Vector3( 0, 0, 1 ),
      B: new THREE.Vector3( 0, 0, - 1 ),
    }[ face ];

    if ( ! normal ) return;

    this.highlightFace( normal );
    this.buildArrow( face, normal, step.notation );

  }

  highlightFace( normal ) {

    const cube = this.game.cube;

    this.glowMaterial = new THREE.MeshBasicMaterial( {
      color: 0xffd166,
      transparent: true,
      opacity: 0.36,
      depthWrite: false,
      side: THREE.DoubleSide,
    } );

    cube.pieces.forEach( piece => {

      const pos = piece.position.clone().multiplyScalar( 3 ).round();

      if ( Math.round( pos.dot( normal ) ) !== 1 ) return;

      // Glow every sticker on the pieces in the layer, not just the stickers
      // on the target face. For a bottom-layer turn the face itself points
      // away from the camera, but the side stickers of that layer are visible
      // and show exactly which slice is about to move.
      piece.children.forEach( child => {

        if ( ! child.isMesh || ! child.name ) return;
        if ( [ 'L', 'R', 'D', 'U', 'B', 'F' ].indexOf( child.name ) < 0 ) return;

        const glow = new THREE.Mesh( child.geometry, this.glowMaterial );
        glow.position.set( 0, 0, 0.006 );
        glow.scale.set( 1.06, 1.06, 1.0 );
        glow.renderOrder = 3;

        child.add( glow );
        this.glows.push( { mesh: glow, parent: child } );

      } );

    } );

  }

  buildArrow( face, normal, notation ) {

    if ( face === 'U' || face === 'D' ) {

      this.buildLayerRing( face, notation );
      return;

    }

    this.buildFaceRing( face, normal, notation );

  }

  // A large halo ring in the plane of the target face. The old face arrow
  // lived inside the face and disappeared for L/B (and F after the yellow
  // view flip). The halo extends beyond the cube's silhouette, so its tube and
  // arrowhead remain visible even when the face points away.
  buildFaceRing( face, normal, notation ) {

    const center = normal.clone().multiplyScalar( 0.535 );
    const basis = {
      R: { u: new THREE.Vector3( 0, 1, 0 ), v: new THREE.Vector3( 0, 0, 1 ) },
      F: { u: new THREE.Vector3( 1, 0, 0 ), v: new THREE.Vector3( 0, 1, 0 ) },
      L: { u: new THREE.Vector3( 0, 0, 1 ), v: new THREE.Vector3( 0, 1, 0 ) },
      B: { u: new THREE.Vector3( 0, 1, 0 ), v: new THREE.Vector3( 1, 0, 0 ) },
    }[ face ];

    if ( ! basis ) return;

    const radius = 0.72;
    const clockwise = notation[ 1 ] !== "'";
    const double = notation[ 1 ] === '2';
    const sweep = double ? Math.PI * 1.7 : Math.PI * 1.25;

    // Put the arrowhead at the top of the ring as seen on screen. The camera
    // stays above the cube, so that point is outside the silhouette and
    // visible for hidden faces too. After the yellow view flip the cube is
    // rotated, so take the world up back into the cube's local frame first.
    const inverse = this.game.cube.object.quaternion.clone().inverse();
    const up = new THREE.Vector3( 0, 1, 0 ).applyQuaternion( inverse );
    up.addScaledVector( normal, - normal.dot( up ) );

    if ( up.lengthSq() < 1e-6 ) return;

    up.normalize();

    const endAngle = Math.atan2( up.dot( basis.v ), up.dot( basis.u ) );
    const startAngle = clockwise ? endAngle + sweep : endAngle - sweep;

    const points = [];
    const segments = 36;

    for ( let i = 0; i <= segments; i++ ) {

      const angle = startAngle + ( endAngle - startAngle ) * ( i / segments );
      const point = center.clone()
        .addScaledVector( basis.u, Math.cos( angle ) * radius )
        .addScaledVector( basis.v, Math.sin( angle ) * radius );

      points.push( point );

    }

    const group = new THREE.Group();
    group.renderOrder = 4;

    this.addArrow( group, points );
    this.group.add( group );
    this.arrowGroup = group;

  }

  // A horizontal ring around the top or bottom slice. The face arrow would be
  // hidden under the cube for U/D turns; the ring stays visible at the slice
  // height and still shows the direction.
  buildLayerRing( face, notation ) {

    const y = face === 'U' ? 0.535 : - 0.535;
    const radius = 0.66;
    const clockwise = notation[ 1 ] !== "'";
    const double = notation[ 1 ] === '2';
    const direction = face === 'U'
      ? ( clockwise ? - 1 : 1 )
      : ( clockwise ? 1 : - 1 );

    const sweep = double ? Math.PI * 1.6 : Math.PI * 1.15;
    const start = direction > 0 ? - sweep / 2 : sweep / 2;
    const points = [];
    const segments = 32;

    for ( let i = 0; i <= segments; i++ ) {

      const angle = start + direction * sweep * ( i / segments );
      points.push( new THREE.Vector3( Math.sin( angle ) * radius, y, Math.cos( angle ) * radius ) );

    }

    const group = new THREE.Group();
    group.renderOrder = 4;

    this.addArrow( group, points );
    this.group.add( group );
    this.arrowGroup = group;

  }

  addArrow( group, points ) {

    const curve = new THREE.CatmullRomCurve3( points );
    const tubeGeometry = new THREE.TubeGeometry( curve, 40, 0.017, 6, false );
    const material = new THREE.MeshBasicMaterial( {
      color: 0xffd166,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      side: THREE.DoubleSide,
    } );

    const tube = new THREE.Mesh( tubeGeometry, material );
    group.add( tube );

    const tangent = points[ points.length - 1 ].clone().sub( points[ points.length - 2 ] ).normalize();
    const coneGeometry = new THREE.ConeGeometry( 0.048, 0.13, 12 );
    const cone = new THREE.Mesh( coneGeometry, material.clone() );
    cone.position.copy( points[ points.length - 1 ] ).addScaledVector( tangent, - 0.025 );
    cone.quaternion.setFromUnitVectors( new THREE.Vector3( 0, 1, 0 ), tangent );
    group.add( cone );

    this.arrowMaterials = [ material, cone.material ];
    this.arrowGeometries = [ tubeGeometry, coneGeometry ];

  }

  update() {

    if ( ! this.glowMaterial && ! this.arrowGroup ) return;

    const time = performance.now();

    if ( this.glowMaterial ) this.glowMaterial.opacity = 0.28 + 0.16 * ( 0.5 + 0.5 * Math.sin( time / 260 ) );
    if ( this.arrowGroup ) this.arrowGroup.scale.setScalar( 1 + 0.025 * Math.sin( time / 300 ) );

  }

}
