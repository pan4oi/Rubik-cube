// A hologram of the cube, standing in the middle of the webcam preview.
//
// The preview is a mirror, but this canvas deliberately is not: it draws text,
// and a mirrored hologram would be unreadable. It also does not follow the
// hands: it is a fixed reference in the centre of the frame.
//
// Landmarks are still flipped when the touch is mapped ( x -> 1 - x ), so the
// highlighted sticker matches the hand in the mirrored video.
//
// The cube is drawn from the real sticker colours of the real pieces, facing
// the player the way a cube sits in a hand: red centre toward you, white up. It
// looks at the cube square on, straight down the front axis, so the face aimed
// at the player is the same colour as the front of the game cube and reads as a
// flat 3×3 grid. The layer a grab is about to turn lights up with chevrons,
// which is the aiming aid: it shows "TOP ROW" and which way it will spin
// before anything moves.
//
// Nothing here touches cube state. RealisticMode passes a small description of
// the gesture and this class only draws it, so the hologram can never turn a
// layer on its own.

const HOLOGRAM_FACES = [
  { key: 'F', n: [ 0, 0, 1 ], u: [ 1, 0, 0 ], v: [ 0, 1, 0 ] },
  { key: 'B', n: [ 0, 0, - 1 ], u: [ - 1, 0, 0 ], v: [ 0, 1, 0 ] },
  { key: 'R', n: [ 1, 0, 0 ], u: [ 0, 0, - 1 ], v: [ 0, 1, 0 ] },
  { key: 'L', n: [ - 1, 0, 0 ], u: [ 0, 0, 1 ], v: [ 0, 1, 0 ] },
  { key: 'U', n: [ 0, 1, 0 ], u: [ 1, 0, 0 ], v: [ 0, 0, - 1 ] },
  { key: 'D', n: [ 0, - 1, 0 ], u: [ 1, 0, 0 ], v: [ 0, 0, 1 ] },
];

const HOLOGRAM_CYAN = [ 126, 236, 255 ];
const HOLOGRAM_HOT = [ 255, 214, 140 ];

class HandHologram {

  constructor( game, options = {} ) {

    this.game = game;

    this.canvas = options.canvas || null;
    this.ctx = this.canvas ? this.canvas.getContext( '2d' ) : null;

    this.width = this.canvas ? this.canvas.width : 0;
    this.height = this.canvas ? this.canvas.height : 0;

    this.alpha = 0;
    this.time = 0;
    this.last = 0;

    this.anchor = new THREE.Vector2();
    this.anchorReady = false;
    this.size = 90;

    // The cube-local frame is drawn as-is, so the red (front) centre always
    // faces the player and white stays up. Sticker colours and piece positions
    // are already cube-local, so the hologram keeps matching the board however
    // the pieces are turned.
    this.cubeQuaternion = new THREE.Quaternion();

    // Straight in front of the cube, looking down -z: the red face fills the
    // hologram and the other faces are edge-on. This is deliberately not the
    // game camera's diagonal, so the face toward the player is unambiguous.
    this.eye = new THREE.Vector3( 0, 0, 3.4 );
    this.eyeDirection = this.eye.clone().normalize();

    // A fixed camera in front of the cube, looking at it from `this.eye`. Built
    // by hand because the three.js build here predates Matrix4.lookAt on cameras
    // that are not in a scene.
    const zAxis = this.eyeDirection.clone();
    const xAxis = new THREE.Vector3( 0, 1, 0 ).cross( zAxis ).normalize();
    const yAxis = zAxis.clone().cross( xAxis ).normalize();

    this.view = new THREE.Matrix4().makeBasis( xAxis, yAxis, zAxis ).transpose();

    // Written straight into the elements: setPosition() in this three.js build
    // only accepts a Vector3, and silently fills the translation with NaN when
    // given three numbers.
    this.view.elements[ 12 ] = - xAxis.dot( this.eye );
    this.view.elements[ 13 ] = - yAxis.dot( this.eye );
    this.view.elements[ 14 ] = - zAxis.dot( this.eye );

    this.pieces = new Map();

    this.tmp = new THREE.Vector3();
    this.spin = new THREE.Quaternion();

    this.state = {
      visible: false,
      label: '',
      hint: '',
      axis: null,
      index: null,
      size: 0,
      highlighted: 0,
      quads: 0,
      anchor: { x: 0, y: 0 },
    };

  }

  clear() {

    if ( this.ctx ) this.ctx.clearRect( 0, 0, this.width, this.height );

    this.alpha = 0;
    this.anchorReady = false;
    this.state.visible = false;
    this.state.label = '';
    this.state.hint = '';
    this.state.highlighted = 0;

  }

  // --- Frame ------------------------------------------------------------

  render( info, now ) {

    if ( ! this.ctx || ! this.width ) return;

    const time = ( now === undefined ) ? performance.now() : now;
    const dt = this.last ? Math.min( ( time - this.last ) / 1000, 0.1 ) : 0.016;

    this.last = time;
    this.time += dt;

    const target = this.pickAnchor();

    this.ctx.clearRect( 0, 0, this.width, this.height );

    if ( ! target ) {

      // Fade out instead of popping: hands leave the frame all the time.
      this.alpha += ( 0 - this.alpha ) * Math.min( 1, dt * 9 );

      this.state.visible = this.alpha > 0.02;
      if ( ! this.state.visible ) this.anchorReady = false;

      if ( this.state.visible && this.anchorReady ) this.draw( info, time );

      return;

    }

    const glide = this.anchorReady ? Math.min( 1, dt * 12 ) : 1;

    this.anchor.x += ( target.x - this.anchor.x ) * glide;
    this.anchor.y += ( target.y - this.anchor.y ) * glide;
    this.size += ( target.size - this.size ) * glide;
    this.anchorReady = true;

    this.alpha += ( 1 - this.alpha ) * Math.min( 1, dt * 9 );

    this.draw( info, time );

  }

  // The hologram is a fixed HUD, not something held: it sits in the middle of
  // the camera frame and never moves with the hands. A reference that stays
  // still is far easier to aim a fingertip at than one that drifts with the
  // palm, and it keeps the highlight in a predictable place.
  pickAnchor() {

    if ( ! this.width || ! this.height ) return null;

    const size = THREE.Math.clamp( Math.min( this.width, this.height ) * 0.29, 54, 140 );

    return {
      x: this.width / 2,
      y: this.height / 2,
      size,
    };

  }

  draw( info, time ) {

    const ctx = this.ctx;
    const width = this.width;
    const height = this.height;

    info = info || {};

    const cx = this.anchor.x;
    const cy = this.anchor.y;
    const size = this.size;

    this.indexPieces();

    ctx.save();
    ctx.globalAlpha = this.alpha;

    // Light on the palm, as if the cube were being projected out of it. The
    // gradient is drawn in a squashed space so it reaches zero exactly at the
    // edge of the ellipse instead of ending on a hard rim.
    const palmX = cx;
    const palmY = Math.min( cy + size * 0.92, height );
    const glowRadius = size * 0.8;

    ctx.save();
    ctx.translate( palmX, palmY );
    ctx.scale( 1, 0.4 );

    const glow = ctx.createRadialGradient( 0, 0, 0, 0, 0, glowRadius );

    glow.addColorStop( 0, 'rgba(120, 232, 255, 0.24)' );
    glow.addColorStop( 0.5, 'rgba(90, 200, 255, 0.09)' );
    glow.addColorStop( 1, 'rgba(90, 200, 255, 0)' );

    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc( 0, 0, glowRadius, 0, Math.PI * 2 );
    ctx.fill();
    ctx.restore();

    // A soft dark field behind the cube. Over a busy camera feed the sticker
    // colours otherwise wash out completely.
    const shade = ctx.createRadialGradient( cx, cy, 0, cx, cy, size * 0.92 );

    shade.addColorStop( 0, 'rgba(4, 16, 26, 0.34)' );
    shade.addColorStop( 0.72, 'rgba(4, 16, 26, 0.2)' );
    shade.addColorStop( 1, 'rgba(4, 16, 26, 0)' );

    ctx.fillStyle = shade;
    ctx.beginPath();
    ctx.arc( cx, cy, size * 0.92, 0, Math.PI * 2 );
    ctx.fill();

    const target = info.target || null;
    const touch = info.touch || null;

    const axis = target ? target.axis : null;
    const index = target ? target.index : null;
    const direction = target ? ( target.direction || 1 ) : 1;

    const quads = [];
    const bounds = { minX: Infinity, minY: Infinity, maxX: - Infinity, maxY: - Infinity };

    let highlighted = 0;

    HOLOGRAM_FACES.forEach( face => {

      const normal = this.cubeNormal( face );
      const front = normal.dot( this.eyeDirection ) > 0;

      for ( let i = - 1; i <= 1; i++ ) {

        for ( let j = - 1; j <= 1; j++ ) {

          const pos = {
            x: face.n[ 0 ] + face.u[ 0 ] * i + face.v[ 0 ] * j,
            y: face.n[ 1 ] + face.u[ 1 ] * i + face.v[ 1 ] * j,
            z: face.n[ 2 ] + face.u[ 2 ] * i + face.v[ 2 ] * j,
          };

          const lit = !! axis && pos[ axis ] === index;
          const held = !! touch && this.isTouched( face, i, j, touch );

          if ( lit ) highlighted++;

          const quad = this.makeQuad( face, i, j, pos, front, lit, held, bounds );

          if ( quad ) quads.push( quad );

        }

      }

    } );

    // Painter's order: the far side of the cube first, so the near side
    // glows over it like glass.
    quads.sort( ( a, b ) => b.depth - a.depth );

    quads.forEach( quad => this.paintQuad( quad, time ) );

    this.drawLattice( bounds, time );

    if ( axis ) this.drawArrows( quads, axis, direction );

    this.drawScanline( bounds, time );

    this.drawCaption( info, bounds );

    ctx.restore();

    this.state.visible = this.alpha > 0.02;
    this.state.label = info.label || '';
    this.state.hint = info.hint || '';
    this.state.axis = axis;
    this.state.index = index;
    this.state.direction = target ? direction : null;
    this.state.size = size;
    this.state.highlighted = highlighted;
    this.state.quads = quads.length;
    this.state.anchor = { x: cx, y: cy };

  }

  // --- Geometry ---------------------------------------------------------

  // Which face of the cube a cube-space normal points at. RealisticMode uses
  // this so the touched sticker and the drawn sticker agree on one name.
  faceKeyForNormal( normal ) {

    if ( ! normal ) return null;

    let axis = 'x';

    if ( Math.abs( normal.y ) > Math.abs( normal[ axis ] ) ) axis = 'y';
    if ( Math.abs( normal.z ) > Math.abs( normal[ axis ] ) ) axis = 'z';

    const sign = Math.sign( normal[ axis ] ) || 1;

    if ( axis === 'x' ) return sign > 0 ? 'R' : 'L';
    if ( axis === 'y' ) return sign > 0 ? 'U' : 'D';

    return sign > 0 ? 'F' : 'B';

  }

  indexPieces() {

    this.pieces.clear();

    const pieces = this.game.cube.pieces;

    if ( ! pieces ) return;

    pieces.forEach( piece => {

      const key = [
        Math.round( piece.position.x * 3 ),
        Math.round( piece.position.y * 3 ),
        Math.round( piece.position.z * 3 ),
      ].join( ',' );

      this.pieces.set( key, piece );

    } );

  }

  // The colour of the sticker currently facing `face` on the piece at `pos`.
  // A sticker keeps its name and colour for life, so after a turn the sticker
  // facing a face has to be found by the direction it points in now, not by its
  // name.
  stickerColor( pos, face ) {

    const piece = this.pieces.get( pos.x + ',' + pos.y + ',' + pos.z );

    if ( ! piece || ! piece.children ) return null;

    const normal = new THREE.Vector3( face.n[ 0 ], face.n[ 1 ], face.n[ 2 ] );

    let colour = null;
    let best = 0.9;

    piece.children.forEach( child => {

      if ( ! child.material || ! child.position || child.position.lengthSq() < 1e-4 ) return;

      const direction = child.position.clone().normalize().applyQuaternion( piece.quaternion );
      const dot = direction.dot( normal );

      if ( dot > best ) {

        best = dot;
        colour = child.material.color;

      }

    } );

    return colour ? colour.clone() : null;

  }

  cubeNormal( face ) {

    return new THREE.Vector3( face.n[ 0 ], face.n[ 1 ], face.n[ 2 ] ).applyQuaternion( this.cubeQuaternion );

  }

  project( point, out ) {

    const view = this.tmp.copy( point ).applyQuaternion( this.cubeQuaternion ).applyMatrix4( this.view );
    const depth = - view.z;

    if ( depth < 0.2 ) return null;

    const k = this.size * ( this.eye.length() / depth );

    const result = out || { x: 0, y: 0, depth: 0 };

    result.x = this.anchor.x + view.x * k;
    result.y = this.anchor.y - view.y * k;
    result.depth = depth;

    return result;

  }

  makeQuad( face, i, j, pos, front, lit, held, bounds ) {

    const center = new THREE.Vector3( pos.x / 3, pos.y / 3, pos.z / 3 );
    const half = ( 1 / 6 ) * 0.87;

    const u = new THREE.Vector3( face.u[ 0 ], face.u[ 1 ], face.u[ 2 ] ).multiplyScalar( half );
    const v = new THREE.Vector3( face.v[ 0 ], face.v[ 1 ], face.v[ 2 ] ).multiplyScalar( half );

    const corners = [
      center.clone().add( u ).add( v ),
      center.clone().sub( u ).add( v ),
      center.clone().sub( u ).sub( v ),
      center.clone().add( u ).sub( v ),
    ];

    const projected = [];

    for ( let c = 0; c < corners.length; c++ ) {

      const point = this.project( corners[ c ] );

      if ( ! point ) return null;

      projected.push( point );

    }

    const depth = ( projected[ 0 ].depth + projected[ 1 ].depth + projected[ 2 ].depth + projected[ 3 ].depth ) / 4;

    projected.forEach( point => {

      bounds.minX = Math.min( bounds.minX, point.x );
      bounds.minY = Math.min( bounds.minY, point.y );
      bounds.maxX = Math.max( bounds.maxX, point.x );
      bounds.maxY = Math.max( bounds.maxY, point.y );

    } );

    const color = this.stickerColor( pos, face );

    return {
      points: projected,
      depth,
      front,
      lit,
      held,
      color,
      center: this.project( center ),
      pos,
    };

  }

  isTouched( face, i, j, touch ) {

    if ( ! touch || ! touch.face ) return false;
    if ( touch.face !== face.key ) return false;

    const local = touch.local;

    if ( ! local ) return false;

    const ti = THREE.Math.clamp( Math.round( ( local.x * face.u[ 0 ] + local.y * face.u[ 1 ] + local.z * face.u[ 2 ] ) * 3 ), - 1, 1 );
    const tj = THREE.Math.clamp( Math.round( ( local.x * face.v[ 0 ] + local.y * face.v[ 1 ] + local.z * face.v[ 2 ] ) * 3 ), - 1, 1 );

    return ti === i && tj === j;

  }

  // --- Painting ---------------------------------------------------------

  paintQuad( quad, time ) {

    const ctx = this.ctx;
    const points = quad.points;
    const base = quad.color || { r: 0.6, g: 0.9, b: 1 };

    const pulse = quad.held ? 0.55 + 0.45 * Math.sin( time * 7 ) : 0;

    let alpha = quad.front ? 0.7 : 0.12;

    if ( quad.lit ) alpha = quad.front ? 0.92 : 0.2;
    if ( quad.held ) alpha = quad.front ? 0.96 : 0.24;

    const tint = quad.lit ? HOLOGRAM_HOT : HOLOGRAM_CYAN;

    // The unlit cubes stay close to their real colours: the red front face has
    // to read as red, not as another shade of cyan, or the hold orientation is
    // lost. Lit stickers go warm so the target still stands out.
    const mix = quad.lit ? 0.64 : 0.06;

    const r = Math.round( ( base.r * 255 ) * ( 1 - mix ) + tint[ 0 ] * mix );
    const g = Math.round( ( base.g * 255 ) * ( 1 - mix ) + tint[ 1 ] * mix );
    const b = Math.round( ( base.b * 255 ) * ( 1 - mix ) + tint[ 2 ] * mix );

    ctx.beginPath();
    ctx.moveTo( points[ 0 ].x, points[ 0 ].y );

    for ( let i = 1; i < points.length; i++ ) ctx.lineTo( points[ i ].x, points[ i ].y );

    ctx.closePath();

    ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';

    if ( quad.lit || quad.held ) {

      ctx.shadowColor = 'rgba(' + tint.join( ',' ) + ',0.85)';
      ctx.shadowBlur = 14 + pulse * 8;

    }

    ctx.fill();

    ctx.shadowBlur = 0;

    ctx.lineWidth = quad.held ? 2 : ( quad.lit ? 2 : 1 );
    ctx.strokeStyle = quad.held
      ? 'rgba(255,255,255,' + ( 0.55 + pulse * 0.35 ) + ')'
      : 'rgba(126,236,255,' + ( quad.front ? ( quad.lit ? 0.95 : 0.32 ) : 0.12 ) + ')';

    ctx.stroke();

  }

  drawLattice( bounds, time ) {

    const ctx = this.ctx;
    const corners = [];

    for ( let x = - 1; x <= 1; x += 2 ) {
      for ( let y = - 1; y <= 1; y += 2 ) {
        for ( let z = - 1; z <= 1; z += 2 ) {
          corners.push( new THREE.Vector3( x / 2, y / 2, z / 2 ) );
        }
      }
    }

    const edges = [
      [ 0, 1 ], [ 1, 3 ], [ 3, 2 ], [ 2, 0 ],
      [ 4, 5 ], [ 5, 7 ], [ 7, 6 ], [ 6, 4 ],
      [ 0, 4 ], [ 1, 5 ], [ 2, 6 ], [ 3, 7 ],
    ];

    const projected = corners.map( corner => this.project( corner ) );

    if ( projected.some( point => ! point ) ) return;

    ctx.save();
    ctx.shadowColor = 'rgba(126,236,255,0.9)';
    ctx.shadowBlur = 8;
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = 'rgba(150,240,255,0.75)';
    ctx.beginPath();

    edges.forEach( ( [ a, b ] ) => {

      ctx.moveTo( projected[ a ].x, projected[ a ].y );
      ctx.lineTo( projected[ b ].x, projected[ b ].y );

    } );

    ctx.stroke();

    // The 3x3 divisions on the faces, so it reads as a cube rather than a box.
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(126,236,255,0.34)';
    ctx.beginPath();

    HOLOGRAM_FACES.forEach( face => {

      const normal = this.cubeNormal( face );

      if ( normal.dot( this.eyeDirection ) <= 0 ) return;

      const u = new THREE.Vector3( face.u[ 0 ], face.u[ 1 ], face.u[ 2 ] );
      const v = new THREE.Vector3( face.v[ 0 ], face.v[ 1 ], face.v[ 2 ] );
      const base = new THREE.Vector3( face.n[ 0 ], face.n[ 1 ], face.n[ 2 ] ).multiplyScalar( 0.5 );

      for ( let line = - 1; line <= 1; line += 2 ) {

        const t = line / 6;

        const a = base.clone().addScaledVector( u, t ).addScaledVector( v, - 0.5 );
        const b = base.clone().addScaledVector( u, t ).addScaledVector( v, 0.5 );
        const c = base.clone().addScaledVector( v, t ).addScaledVector( u, - 0.5 );
        const d = base.clone().addScaledVector( v, t ).addScaledVector( u, 0.5 );

        const pa = this.project( a ), pb = this.project( b );
        const pc = this.project( c ), pd = this.project( d );

        if ( pa && pb ) {

          ctx.moveTo( pa.x, pa.y );
          ctx.lineTo( pb.x, pb.y );

        }

        if ( pc && pd ) {

          ctx.moveTo( pc.x, pc.y );
          ctx.lineTo( pd.x, pd.y );

        }

      }

    } );

    ctx.stroke();
    ctx.restore();

    // Corner brackets: a HUD flourish around the projected cube.
    const pad = this.size * 0.14;
    const left = bounds.minX - pad;
    const right = bounds.maxX + pad;
    const top = bounds.minY - pad;
    const bottom = bounds.maxY + pad;
    const arm = Math.min( right - left, bottom - top ) * 0.18;

    ctx.save();
    ctx.strokeStyle = 'rgba(126,236,255,0.4)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();

    [ [ left, top, 1, 1 ], [ right, top, - 1, 1 ], [ left, bottom, 1, - 1 ], [ right, bottom, - 1, - 1 ] ].forEach( ( [ x, y, sx, sy ] ) => {

      ctx.moveTo( x + sx * arm, y );
      ctx.lineTo( x, y );
      ctx.lineTo( x, y + sy * arm );

    } );

    ctx.stroke();
    ctx.restore();

  }

  drawArrows( quads, axis, direction ) {

    const ctx = this.ctx;
    const size = this.size;

    this.spin.setFromAxisAngle(
      new THREE.Vector3( axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0 ),
      0.5 * ( direction || 1 )
    );

    ctx.save();
    ctx.strokeStyle = 'rgba(255, 238, 190, 0.9)';
    ctx.fillStyle = 'rgba(255, 238, 190, 0.95)';
    ctx.shadowColor = 'rgba(255, 214, 140, 0.9)';
    ctx.shadowBlur = 8;
    ctx.lineWidth = 2.6;

    // Only the nearest few lit stickers get a chevron. More than that and the
    // layer turns into visual noise instead of an arrow.
    const lit = quads
      .filter( quad => quad.lit && quad.front && quad.center )
      .sort( ( a, b ) => a.depth - b.depth )
      .slice( 0, 3 );

    lit.forEach( quad => {

      const center = quad.center;
      const local = new THREE.Vector3( quad.pos.x / 3, quad.pos.y / 3, quad.pos.z / 3 );

      const moved = local.clone().applyQuaternion( this.spin );
      const from = this.project( local );
      const to = this.project( moved );

      if ( ! center || ! from || ! to ) return;

      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const distance = Math.sqrt( dx * dx + dy * dy );

      if ( distance < 2 ) return;

      const ux = dx / distance;
      const uy = dy / distance;
      const length = size * 0.16;
      const head = length * 0.44;

      // A chevron sliding along the turn, its phase pulsing so the direction
      // reads even in a still frame.
      const phase = ( ( performance.now() * 0.0016 ) % 1 ) - 0.5;
      const ox = center.x + ux * phase * length;
      const oy = center.y + uy * phase * length;

      ctx.beginPath();
      ctx.moveTo( ox - ux * length * 0.35 - uy * head * 0.6, oy - uy * length * 0.35 + ux * head * 0.6 );
      ctx.lineTo( ox + ux * length * 0.4, oy + uy * length * 0.4 );
      ctx.lineTo( ox - ux * length * 0.35 + uy * head * 0.6, oy - uy * length * 0.35 - ux * head * 0.6 );
      ctx.stroke();

    } );

    ctx.restore();

  }

  drawScanline( bounds, time ) {

    const ctx = this.ctx;
    const span = bounds.maxY - bounds.minY;

    if ( ! isFinite( span ) || span <= 0 ) return;

    const y = bounds.minY + ( ( time * 0.22 ) % 1 ) * span;

    ctx.save();
    ctx.beginPath();
    ctx.rect( bounds.minX - 2, bounds.minY, bounds.maxX - bounds.minX + 4, span );
    ctx.clip();

    ctx.strokeStyle = 'rgba(155, 244, 255, 0.28)';
    ctx.lineWidth = 1.5;
    ctx.shadowColor = 'rgba(126,236,255,0.8)';
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.moveTo( bounds.minX - 2, y );
    ctx.lineTo( bounds.maxX + 2, y );
    ctx.stroke();

    ctx.restore();

  }

  drawCaption( info, bounds ) {

    const ctx = this.ctx;
    const label = ( info.label || '' ).toUpperCase();
    const hint = ( info.hint || '' ).toUpperCase();

    if ( ! label && ! hint ) return;

    const width = this.width;
    const height = this.height;

    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    try {
      ctx.letterSpacing = '1.5px';
    } catch ( error ) {}

    let y = bounds.maxY + this.size * 0.2;

    if ( y > height - 26 ) y = bounds.minY - this.size * 0.2;
    if ( y < 18 ) y = Math.min( height - 18, bounds.maxY + this.size * 0.2 );

    if ( label ) {

      ctx.font = '600 ' + Math.round( this.size * 0.15 ) + 'px "Segoe UI", system-ui, sans-serif';

      const textWidth = ctx.measureText( label ).width;
      const padding = 8;
      const boxHeight = this.size * 0.2;

      let x = THREE.Math.clamp( this.anchor.x, textWidth / 2 + padding + 4, width - textWidth / 2 - padding - 4 );
      y = THREE.Math.clamp( y, boxHeight / 2 + 4, height - boxHeight / 2 - 4 );

      const boxX = x - textWidth / 2 - padding;
      const boxY = y - boxHeight / 2;
      const boxW = textWidth + padding * 2;

      this.roundRect( boxX, boxY, boxW, boxHeight, boxHeight / 2 );
      ctx.fillStyle = 'rgba(6, 18, 28, 0.62)';
      ctx.fill();

      ctx.strokeStyle = 'rgba(126, 236, 255, 0.45)';
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = 'rgba(214, 250, 255, 0.98)';
      ctx.shadowColor = 'rgba(126, 236, 255, 0.9)';
      ctx.shadowBlur = 8;
      ctx.fillText( label, x, y + 0.5 );

      ctx.shadowBlur = 0;

      if ( hint ) {

        ctx.font = '600 ' + Math.round( this.size * 0.1 ) + 'px "Segoe UI", system-ui, sans-serif';
        ctx.fillStyle = 'rgba(255, 224, 170, 0.92)';
        ctx.fillText( hint, x, y + boxHeight / 2 + this.size * 0.11 );

      }

    } else if ( hint ) {

      ctx.font = '600 ' + Math.round( this.size * 0.11 ) + 'px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = 'rgba(200, 246, 255, 0.9)';
      ctx.fillText( hint, THREE.Math.clamp( this.anchor.x, 40, width - 40 ), y );

    }

    ctx.restore();

  }

  roundRect( x, y, width, height, radius ) {

    const ctx = this.ctx;
    const r = Math.min( radius, width / 2, height / 2 );

    ctx.beginPath();
    ctx.moveTo( x + r, y );
    ctx.lineTo( x + width - r, y );
    ctx.quadraticCurveTo( x + width, y, x + width, y + r );
    ctx.lineTo( x + width, y + height - r );
    ctx.quadraticCurveTo( x + width, y + height, x + width - r, y + height );
    ctx.lineTo( x + r, y + height );
    ctx.quadraticCurveTo( x, y + height, x, y + height - r );
    ctx.lineTo( x, y + r );
    ctx.quadraticCurveTo( x, y, x + r, y );
    ctx.closePath();

  }

}
