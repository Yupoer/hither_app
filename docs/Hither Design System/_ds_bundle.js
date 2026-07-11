/* @ds-bundle: {"format":4,"namespace":"HitherDesignSystem_fea0fc","components":[{"name":"Avatar","sourcePath":"components/core/Avatar.jsx"},{"name":"Banner","sourcePath":"components/core/Banner.jsx"},{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"Card","sourcePath":"components/core/Card.jsx"},{"name":"IconButton","sourcePath":"components/core/IconButton.jsx"},{"name":"Pill","sourcePath":"components/core/Pill.jsx"},{"name":"Input","sourcePath":"components/forms/Input.jsx"},{"name":"Segmented","sourcePath":"components/forms/Segmented.jsx"},{"name":"Switch","sourcePath":"components/forms/Switch.jsx"},{"name":"GlassSurface","sourcePath":"components/glass/GlassSurface.jsx"},{"name":"DistanceChip","sourcePath":"components/hither/DistanceChip.jsx"},{"name":"GatherPointRow","sourcePath":"components/hither/GatherPointRow.jsx"},{"name":"GroupChip","sourcePath":"components/hither/GroupChip.jsx"},{"name":"MapControl","sourcePath":"components/hither/MapControl.jsx"},{"name":"MemberMarker","sourcePath":"components/hither/MemberMarker.jsx"},{"name":"MemberRow","sourcePath":"components/hither/MemberRow.jsx"},{"name":"ProgressDots","sourcePath":"components/hither/ProgressDots.jsx"},{"name":"RolePill","sourcePath":"components/hither/RolePill.jsx"}],"sourceHashes":{"components/core/Avatar.jsx":"f53e92af62d3","components/core/Banner.jsx":"5e3ddade7c52","components/core/Button.jsx":"eb1bd9314b46","components/core/Card.jsx":"732f5b1b600e","components/core/IconButton.jsx":"cb2fcabbd77c","components/core/Pill.jsx":"e3e05285cb54","components/forms/Input.jsx":"6afeeb3ac239","components/forms/Segmented.jsx":"ef3cdfef922d","components/forms/Switch.jsx":"70c4cb7fd438","components/glass/GlassSurface.jsx":"ed9ea9c151aa","components/hither/DistanceChip.jsx":"39e640f900d2","components/hither/GatherPointRow.jsx":"d53db2987efd","components/hither/GroupChip.jsx":"ce571c80c9d9","components/hither/MapControl.jsx":"4934800f6797","components/hither/MemberMarker.jsx":"b2ef680cda3c","components/hither/MemberRow.jsx":"a18c29ad8b41","components/hither/ProgressDots.jsx":"392cb4511da4","components/hither/RolePill.jsx":"7fd07609f460","ui_kits/hither_ios/FollowerNav.jsx":"d5e5d7b97c39","ui_kits/hither_ios/MapHome.jsx":"dd10c5d5939c","ui_kits/hither_ios/MembersSheet.jsx":"78cf27fdca12","ui_kits/hither_ios/Onboarding.jsx":"2a2c8ab771a8","ui_kits/hither_ios/SetGatherPoint.jsx":"1424f5bd723b","ui_kits/hither_ios/frame.jsx":"a5feaa5f461a"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.HitherDesignSystem_fea0fc = window.HitherDesignSystem_fea0fc || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/core/Avatar.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Circular member avatar with a bold colored ring — the "smiley marker" motif.
 * Each member gets a role color. Ring signals presence; dimmed = offline/lost.
 * Supports emoji, initials, or image.
 */
function Avatar({
  label = '',
  emoji = null,
  src = null,
  color = 'pink',
  size = 44,
  ring = true,
  dimmed = false,
  leader = false,
  style = {},
  ...rest
}) {
  const map = {
    signal: '#FF6B35',
    sky: '#37B6FF',
    pink: '#FF44C4',
    cyan: '#33E0D6',
    success: '#3DDC84',
    sun: '#FFD84D',
    neutral: '#6B7078'
  };
  const ringColor = dimmed ? 'var(--ink-600)' : map[color] || map.pink;
  const initials = label ? label.trim().slice(0, 2).toUpperCase() : '';
  return /*#__PURE__*/React.createElement("div", _extends({
    title: label,
    style: {
      position: 'relative',
      width: size,
      height: size,
      minWidth: size,
      borderRadius: 'var(--radius-pill)',
      background: dimmed ? 'var(--ink-700)' : map[color] || map.pink,
      border: ring ? `${Math.max(2, size * 0.06)}px solid ${ringColor}` : 'none',
      boxShadow: ring && !dimmed ? `0 0 0 2px var(--bg-app), 0 4px 12px rgba(0,0,0,0.4)` : 'none',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      opacity: dimmed ? 0.6 : 1,
      color: '#0A0A0C',
      fontFamily: 'var(--font-display)',
      fontWeight: 'var(--fw-bold)',
      fontSize: `${Math.round(size * 0.4)}px`,
      ...style
    }
  }, rest), src ? /*#__PURE__*/React.createElement("img", {
    src: src,
    alt: label,
    style: {
      width: '100%',
      height: '100%',
      objectFit: 'cover'
    }
  }) : emoji ? /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: `${Math.round(size * 0.5)}px`
    }
  }, emoji) : initials, leader && /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      top: -6,
      right: -6,
      width: size * 0.42,
      height: size * 0.42,
      borderRadius: '50%',
      background: 'var(--sun-500)',
      border: '2px solid var(--bg-app)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: size * 0.26
    }
  }, "\u2605"));
}
Object.assign(__ds_scope, { Avatar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Avatar.jsx", error: String((e && e.message) || e) }); }

// components/core/Banner.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Inline banner / callout strip. Playful tinted background with an icon slot.
 * Used for tips ("回転して撮影"-style hints), status, and the Duolingo-y nudges.
 */
function Banner({
  children,
  icon = null,
  tone = 'signal',
  style = {},
  ...rest
}) {
  const map = {
    signal: '255,107,53',
    sky: '55,182,255',
    success: '61,220,132',
    neutral: '150,155,163'
  };
  const rgb = map[tone] || map.signal;
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      padding: '12px 16px',
      borderRadius: 'var(--radius-md)',
      background: `rgba(${rgb},0.14)`,
      color: 'var(--text-primary)',
      fontFamily: 'var(--font-ui)',
      fontSize: 'var(--text-callout)',
      fontWeight: 'var(--fw-medium)',
      ...style
    }
  }, rest), icon && /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: 30,
      height: 30,
      borderRadius: '50%',
      flexShrink: 0,
      background: `rgb(${rgb})`,
      color: '#0A0A0C',
      fontSize: '17px'
    }
  }, icon), /*#__PURE__*/React.createElement("span", {
    style: {
      lineHeight: 'var(--lh-normal)'
    }
  }, children));
}
Object.assign(__ds_scope, { Banner });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Banner.jsx", error: String((e && e.message) || e) }); }

// components/core/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Hither primary action button. Chunky, pill-shaped, springy on press.
 * Variants: primary (Signal Orange), secondary (Electric Sky), ghost, success.
 */
function Button({
  children,
  variant = 'primary',
  size = 'lg',
  full = false,
  disabled = false,
  iconLeft = null,
  iconRight = null,
  style = {},
  ...rest
}) {
  const palettes = {
    primary: {
      bg: 'var(--signal-500)',
      bgHover: 'var(--signal-400)',
      fg: 'var(--on-accent)',
      glow: 'var(--glow-signal)'
    },
    secondary: {
      bg: 'var(--sky-500)',
      bgHover: 'var(--sky-400)',
      fg: '#04263B',
      glow: 'var(--glow-sky)'
    },
    success: {
      bg: 'var(--meadow-500)',
      bgHover: 'var(--meadow-400)',
      fg: '#043318',
      glow: 'var(--glow-success)'
    },
    ghost: {
      bg: 'var(--surface-input)',
      bgHover: 'var(--ink-600)',
      fg: 'var(--text-primary)',
      glow: 'none'
    },
    glass: {
      bg: 'var(--glass-fill)',
      bgHover: 'var(--glass-fill-light)',
      fg: 'var(--text-primary)',
      glow: 'none'
    }
  };
  const p = palettes[variant] || palettes.primary;
  const isGlass = variant === 'glass';
  const sizes = {
    lg: {
      height: 'var(--h-button)',
      padding: '0 26px',
      font: 'var(--text-title)'
    },
    sm: {
      height: 'var(--h-button-sm)',
      padding: '0 18px',
      font: 'var(--text-callout)'
    }
  };
  const s = sizes[size] || sizes.lg;
  const [pressed, setPressed] = React.useState(false);
  const [hover, setHover] = React.useState(false);
  return /*#__PURE__*/React.createElement("button", _extends({
    disabled: disabled,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => {
      setHover(false);
      setPressed(false);
    },
    onMouseDown: () => setPressed(true),
    onMouseUp: () => setPressed(false),
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '10px',
      width: full ? '100%' : 'auto',
      height: s.height,
      padding: s.padding,
      fontFamily: 'var(--font-display)',
      fontWeight: 'var(--fw-semibold)',
      fontSize: s.font,
      letterSpacing: '0.01em',
      color: disabled ? 'var(--text-muted)' : p.fg,
      background: disabled ? 'var(--ink-700)' : hover ? p.bgHover : p.bg,
      backdropFilter: isGlass ? 'var(--glass-blur)' : 'none',
      WebkitBackdropFilter: isGlass ? 'var(--glass-blur)' : 'none',
      border: isGlass ? '1px solid var(--glass-edge)' : 'none',
      borderRadius: 'var(--radius-pill)',
      cursor: disabled ? 'not-allowed' : 'pointer',
      boxShadow: disabled || variant === 'ghost' ? 'none' : isGlass ? 'var(--glass-shadow), var(--glass-inner-hi)' : hover ? p.glow : '0 2px 10px rgba(0,0,0,0.3)',
      transform: pressed && !disabled ? 'scale(var(--press-scale))' : 'scale(1)',
      transition: 'transform var(--dur-fast) var(--ease-spring), background var(--dur-base) var(--ease-out), box-shadow var(--dur-base) var(--ease-out)',
      WebkitTapHighlightColor: 'transparent',
      ...style
    }
  }, rest), iconLeft && /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      fontSize: '1.25em'
    }
  }, iconLeft), children, iconRight && /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      fontSize: '1.25em'
    }
  }, iconRight));
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/Card.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Rounded dark surface card — the primary container in Hither.
 * Optional accent glow to promote a card to "active / attention".
 */
function Card({
  children,
  elevated = false,
  glow = null,
  padding = 20,
  style = {},
  ...rest
}) {
  const glows = {
    signal: 'var(--glow-signal)',
    sky: 'var(--glow-sky)',
    pink: 'var(--glow-pink)',
    success: 'var(--glow-success)'
  };
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      background: elevated ? 'var(--surface-card-elevated)' : 'var(--surface-card)',
      borderRadius: 'var(--radius-lg)',
      padding: typeof padding === 'number' ? `${padding}px` : padding,
      boxShadow: glow ? glows[glow] : 'var(--shadow-card)',
      color: 'var(--text-primary)',
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Card.jsx", error: String((e && e.message) || e) }); }

// components/core/IconButton.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Circular icon button — used for +, bell, close, and map controls.
 * Sits on dark surfaces as a soft charcoal circle; can be tinted with an accent.
 */
function IconButton({
  children,
  size = 44,
  tone = 'neutral',
  disabled = false,
  style = {},
  ...rest
}) {
  const tones = {
    neutral: {
      bg: 'var(--surface-card-elevated)',
      fg: 'var(--text-primary)'
    },
    signal: {
      bg: 'var(--signal-500)',
      fg: 'var(--on-accent)'
    },
    sky: {
      bg: 'var(--sky-500)',
      fg: '#04263B'
    },
    glass: {
      bg: 'rgba(30,32,36,0.72)',
      fg: 'var(--text-primary)'
    }
  };
  const t = tones[tone] || tones.neutral;
  const [pressed, setPressed] = React.useState(false);
  return /*#__PURE__*/React.createElement("button", _extends({
    disabled: disabled,
    onMouseDown: () => setPressed(true),
    onMouseUp: () => setPressed(false),
    onMouseLeave: () => setPressed(false),
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: size,
      height: size,
      minWidth: size,
      borderRadius: 'var(--radius-pill)',
      border: 'none',
      background: t.bg,
      color: t.fg,
      cursor: disabled ? 'not-allowed' : 'pointer',
      fontSize: `${Math.round(size * 0.46)}px`,
      backdropFilter: tone === 'glass' ? 'blur(14px)' : 'none',
      transform: pressed ? 'scale(var(--press-scale))' : 'scale(1)',
      transition: 'transform var(--dur-fast) var(--ease-spring), background var(--dur-base) var(--ease-out)',
      WebkitTapHighlightColor: 'transparent',
      opacity: disabled ? 0.5 : 1,
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { IconButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/IconButton.jsx", error: String((e && e.message) || e) }); }

// components/core/Pill.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Small rounded label / status chip. Solid or soft (tinted) fill.
 * Used for roles (Leader/Follower), status (Arrived, En route), counts.
 */
function Pill({
  children,
  color = 'signal',
  soft = false,
  style = {},
  ...rest
}) {
  const map = {
    signal: '255,107,53',
    sky: '55,182,255',
    pink: '255,68,196',
    cyan: '51,224,214',
    success: '61,220,132',
    sun: '255,216,77',
    neutral: '150,155,163'
  };
  const rgb = map[color] || map.signal;
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      padding: '5px 12px',
      borderRadius: 'var(--radius-pill)',
      fontFamily: 'var(--font-ui)',
      fontWeight: 'var(--fw-bold)',
      fontSize: 'var(--text-footnote)',
      letterSpacing: '0.01em',
      lineHeight: 1,
      color: soft ? `rgb(${rgb})` : '#0A0A0C',
      background: soft ? `rgba(${rgb},0.16)` : `rgb(${rgb})`,
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { Pill });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Pill.jsx", error: String((e && e.message) || e) }); }

// components/forms/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Text input on dark surface. Rounded, roomy tap target, sky focus ring.
 */
function Input({
  value,
  onChange,
  placeholder = '',
  iconLeft = null,
  type = 'text',
  style = {},
  ...rest
}) {
  const [focus, setFocus] = React.useState(false);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      height: 'var(--h-input)',
      padding: '0 16px',
      background: 'var(--surface-input)',
      borderRadius: 'var(--radius-md)',
      border: `1.5px solid ${focus ? 'var(--sky-500)' : 'transparent'}`,
      boxShadow: focus ? 'var(--ring-focus)' : 'none',
      transition: 'border var(--dur-fast), box-shadow var(--dur-fast)',
      ...style
    }
  }, iconLeft && /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-muted)',
      fontSize: '18px',
      display: 'inline-flex'
    }
  }, iconLeft), /*#__PURE__*/React.createElement("input", _extends({
    type: type,
    value: value,
    onChange: onChange,
    placeholder: placeholder,
    onFocus: () => setFocus(true),
    onBlur: () => setFocus(false),
    style: {
      flex: 1,
      minWidth: 0,
      background: 'transparent',
      border: 'none',
      outline: 'none',
      color: 'var(--text-primary)',
      fontFamily: 'var(--font-ui)',
      fontSize: 'var(--text-body)',
      fontWeight: 'var(--fw-medium)'
    }
  }, rest)));
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Input.jsx", error: String((e && e.message) || e) }); }

// components/forms/Segmented.jsx
try { (() => {
/**
 * Segmented control — the Leader / Follower role toggle and view switchers.
 * Sliding highlight pill behind the active segment.
 */
function Segmented({
  options = [],
  value,
  onChange = () => {},
  style = {}
}) {
  const idx = Math.max(0, options.findIndex(o => (o.value ?? o) === value));
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      display: 'grid',
      gridTemplateColumns: `repeat(${options.length}, 1fr)`,
      background: 'var(--surface-input)',
      borderRadius: 'var(--radius-pill)',
      padding: 4,
      height: 46,
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      top: 4,
      bottom: 4,
      left: 4,
      width: `calc((100% - 8px) / ${options.length})`,
      transform: `translateX(${idx * 100}%)`,
      background: 'var(--signal-500)',
      borderRadius: 'var(--radius-pill)',
      boxShadow: 'var(--glow-signal)',
      transition: 'transform var(--dur-base) var(--ease-spring)'
    }
  }), options.map(o => {
    const val = o.value ?? o;
    const lbl = o.label ?? o;
    const active = val === value;
    return /*#__PURE__*/React.createElement("button", {
      key: val,
      onClick: () => onChange(val),
      style: {
        position: 'relative',
        zIndex: 1,
        border: 'none',
        background: 'transparent',
        cursor: 'pointer',
        fontFamily: 'var(--font-display)',
        fontWeight: 'var(--fw-semibold)',
        fontSize: 'var(--text-callout)',
        color: active ? 'var(--on-accent)' : 'var(--text-secondary)',
        transition: 'color var(--dur-base)'
      }
    }, lbl);
  }));
}
Object.assign(__ds_scope, { Segmented });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Segmented.jsx", error: String((e && e.message) || e) }); }

// components/forms/Switch.jsx
try { (() => {
/**
 * iOS-style toggle switch. On = Signal Orange. Springy thumb.
 */
function Switch({
  checked = false,
  onChange = () => {},
  disabled = false,
  style = {}
}) {
  return /*#__PURE__*/React.createElement("button", {
    role: "switch",
    "aria-checked": checked,
    disabled: disabled,
    onClick: () => !disabled && onChange(!checked),
    style: {
      width: 52,
      height: 32,
      borderRadius: 'var(--radius-pill)',
      border: 'none',
      background: checked ? 'var(--signal-500)' : 'var(--ink-600)',
      position: 'relative',
      cursor: disabled ? 'not-allowed' : 'pointer',
      padding: 0,
      opacity: disabled ? 0.5 : 1,
      transition: 'background var(--dur-base) var(--ease-out)',
      boxShadow: checked ? 'var(--glow-signal)' : 'none',
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      top: 3,
      left: checked ? 23 : 3,
      width: 26,
      height: 26,
      borderRadius: '50%',
      background: '#fff',
      boxShadow: '0 2px 5px rgba(0,0,0,0.4)',
      transition: 'left var(--dur-base) var(--ease-spring)'
    }
  }));
}
Object.assign(__ds_scope, { Switch });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Switch.jsx", error: String((e && e.message) || e) }); }

// components/glass/GlassSurface.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * GlassSurface — the foundational Liquid Glass material slab.
 * Everything that floats over the map (chips, capsules, sheets, popovers) is
 * built on this. Handles blur, translucent fill, specular edge + sheen, shadow.
 *
 * variant: 'pane' (default rounded card) | 'pill' | 'sheet' | 'capsule'
 * weight:  'regular' | 'thin' | 'heavy'   (blur/opacity intensity)
 * tint:    null | 'accent' | 'sky' | 'success'   (themed glass)
 */
function GlassSurface({
  children,
  variant = 'pane',
  weight = 'regular',
  tint = null,
  sheen = true,
  style = {},
  ...rest
}) {
  const blur = {
    regular: 'var(--glass-blur)',
    thin: 'var(--glass-blur-thin)',
    heavy: 'var(--glass-blur-strong)'
  }[weight];
  const fill = tint ? {
    accent: 'var(--glass-fill-accent)',
    sky: 'rgba(55,182,255,0.20)',
    success: 'rgba(74,222,128,0.20)'
  }[tint] : {
    regular: 'var(--glass-fill)',
    thin: 'var(--glass-fill-light)',
    heavy: 'var(--glass-fill-heavy)'
  }[weight];
  const radius = {
    pane: 'var(--radius-lg)',
    pill: 'var(--radius-pill)',
    sheet: 'var(--radius-2xl) var(--radius-2xl) 0 0',
    capsule: 'var(--radius-xl)'
  }[variant];
  const shadow = variant === 'sheet' ? 'var(--glass-shadow-sheet)' : 'var(--glass-shadow)';
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      position: 'relative',
      isolation: 'isolate',
      background: fill,
      backdropFilter: blur,
      WebkitBackdropFilter: blur,
      border: '1px solid var(--glass-edge)',
      borderRadius: radius,
      boxShadow: `${shadow}, var(--glass-inner-hi), var(--glass-inner-lo)`,
      color: 'var(--text-primary)',
      overflow: 'hidden',
      ...style
    }
  }, rest), sheen && /*#__PURE__*/React.createElement("span", {
    "aria-hidden": true,
    style: {
      position: 'absolute',
      inset: 0,
      borderRadius: 'inherit',
      background: 'var(--glass-sheen)',
      pointerEvents: 'none',
      zIndex: 0
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      zIndex: 1
    }
  }, children));
}
Object.assign(__ds_scope, { GlassSurface });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/glass/GlassSurface.jsx", error: String((e && e.message) || e) }); }

// components/hither/DistanceChip.jsx
try { (() => {
/**
 * DistanceChip — the twin readout of walking time + straight-line distance to a
 * gather point. Core to Hither's "which way, how far" answer. Two sizes.
 * layout: 'stack' (time over distance, right-aligned) | 'inline'
 */
function DistanceChip({
  time = '3 min',
  distance = '273 m',
  size = 'md',
  tone = 'default',
  layout = 'stack',
  style = {}
}) {
  const timeColor = tone === 'accent' ? 'var(--accent)' : 'var(--text-primary)';
  const timeSize = size === 'lg' ? 'var(--text-display-sm)' : 'var(--text-title)';
  if (layout === 'inline') {
    return /*#__PURE__*/React.createElement("span", {
      style: {
        display: 'inline-flex',
        alignItems: 'baseline',
        gap: 8,
        ...style
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: 'var(--font-display)',
        fontWeight: 'var(--fw-bold)',
        fontSize: timeSize,
        color: timeColor
      }
    }, time), /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--text-muted)',
        fontWeight: 'var(--fw-medium)',
        fontSize: 'var(--text-footnote)'
      }
    }, distance));
  }
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'flex-end',
      gap: 2,
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-display)',
      fontWeight: 'var(--fw-bold)',
      fontSize: timeSize,
      color: timeColor,
      lineHeight: 1
    }
  }, time), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-muted)',
      fontWeight: 'var(--fw-medium)',
      fontSize: 'var(--text-footnote)'
    }
  }, distance));
}
Object.assign(__ds_scope, { DistanceChip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/hither/DistanceChip.jsx", error: String((e && e.message) || e) }); }

// components/hither/GatherPointRow.jsx
try { (() => {
/**
 * GatherPointRow — a list row with a rounded accent icon tile, a title, and an
 * optional trailing action/chevron. Used for gather points, KML import, etc.
 */
function GatherPointRow({
  icon = '🚩',
  title,
  trailing = null,
  tileTone = 'success',
  onClick,
  style = {}
}) {
  const tiles = {
    success: 'rgba(74,222,128,0.18)',
    accent: 'rgba(255,107,53,0.18)',
    sky: 'rgba(55,182,255,0.18)'
  };
  const tileFg = {
    success: 'var(--grass-500)',
    accent: 'var(--accent)',
    sky: 'var(--sky-500)'
  };
  return /*#__PURE__*/React.createElement("button", {
    onClick: onClick,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 14,
      width: '100%',
      textAlign: 'left',
      padding: 12,
      border: '1px solid var(--glass-edge)',
      background: 'var(--glass-fill)',
      backdropFilter: 'var(--glass-blur-thin)',
      WebkitBackdropFilter: 'var(--glass-blur-thin)',
      borderRadius: 'var(--radius-md)',
      cursor: 'pointer',
      WebkitTapHighlightColor: 'transparent',
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 48,
      height: 48,
      borderRadius: 'var(--radius-sm)',
      flexShrink: 0,
      background: tiles[tileTone],
      color: tileFg[tileTone],
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: 22
    }
  }, icon), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      fontFamily: 'var(--font-display)',
      fontWeight: 'var(--fw-semibold)',
      fontSize: 'var(--text-title)',
      color: 'var(--text-primary)'
    }
  }, title), trailing);
}
Object.assign(__ds_scope, { GatherPointRow });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/hither/GatherPointRow.jsx", error: String((e && e.message) || e) }); }

// components/hither/GroupChip.jsx
try { (() => {
/**
 * GroupChip — floating glass pill (top-left of the map): a stack of overlapping
 * member avatars, the group name, and the member count. Matches the live app.
 */
function GroupChip({
  name = 'Group',
  count = 0,
  members = [],
  onClick,
  style = {}
}) {
  const shown = members.slice(0, 3);
  return /*#__PURE__*/React.createElement("button", {
    onClick: onClick,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '10px',
      height: 46,
      padding: '0 16px 0 6px',
      border: '1px solid var(--glass-edge)',
      background: 'var(--glass-fill)',
      backdropFilter: 'var(--glass-blur)',
      WebkitBackdropFilter: 'var(--glass-blur)',
      borderRadius: 'var(--radius-pill)',
      boxShadow: 'var(--glass-shadow), var(--glass-inner-hi)',
      cursor: 'pointer',
      WebkitTapHighlightColor: 'transparent',
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: 'inline-flex',
      paddingLeft: 6
    }
  }, shown.map((m, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    style: {
      marginLeft: i === 0 ? 0 : -12,
      borderRadius: '50%',
      boxShadow: '0 0 0 2px var(--glass-fill-heavy)'
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Avatar, {
    emoji: m.emoji,
    label: m.label,
    color: m.color,
    size: 30,
    ring: false
  })))), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-display)',
      fontWeight: 'var(--fw-semibold)',
      fontSize: 'var(--text-title)',
      color: 'var(--text-primary)'
    }
  }, name), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-muted)',
      fontWeight: 'var(--fw-semibold)',
      fontSize: 'var(--text-callout)'
    }
  }, "\xB7 ", count));
}
Object.assign(__ds_scope, { GroupChip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/hither/GroupChip.jsx", error: String((e && e.message) || e) }); }

// components/hither/MapControl.jsx
try { (() => {
/**
 * MapControl — vertical glass capsule holding stacked round icon controls
 * (fullscreen, recenter/compass), like the live app's lower-right controls.
 * Pass an array of { icon, onClick, active } items.
 */
function MapControl({
  items = [],
  style = {}
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      width: 52,
      background: 'var(--glass-fill)',
      backdropFilter: 'var(--glass-blur)',
      WebkitBackdropFilter: 'var(--glass-blur)',
      border: '1px solid var(--glass-edge)',
      borderRadius: 'var(--radius-xl)',
      boxShadow: 'var(--glass-shadow), var(--glass-inner-hi)',
      overflow: 'hidden',
      ...style
    }
  }, items.map((it, i) => /*#__PURE__*/React.createElement(React.Fragment, {
    key: i
  }, i > 0 && /*#__PURE__*/React.createElement("span", {
    style: {
      height: 1,
      background: 'var(--glass-edge)',
      margin: '0 8px'
    }
  }), /*#__PURE__*/React.createElement("button", {
    onClick: it.onClick,
    style: {
      height: 52,
      border: 'none',
      background: 'transparent',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: it.active ? 'var(--accent)' : 'var(--text-primary)',
      fontSize: 20,
      WebkitTapHighlightColor: 'transparent'
    }
  }, it.icon))));
}
Object.assign(__ds_scope, { MapControl });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/hither/MapControl.jsx", error: String((e && e.message) || e) }); }

// components/hither/MemberMarker.jsx
try { (() => {
/**
 * MemberMarker — a map marker for a person: a colored teardrop pin holding an
 * emoji/initial, with a white ring so it pops on the basemap. `pulse` adds a
 * live locating halo. Use `gather` for the destination beacon variant.
 */
function MemberMarker({
  emoji,
  label,
  color = 'pink',
  size = 48,
  pulse = false,
  gather = false,
  style = {}
}) {
  const map = {
    signal: '#FF6B35',
    sky: '#37B6FF',
    pink: '#FF44C4',
    cyan: '#33E0D6',
    success: '#4ADE80',
    sun: '#FFD84D',
    plum: '#A97BFF',
    neutral: '#6C737F'
  };
  const c = gather ? 'var(--accent)' : map[color] || map.pink;
  const cRaw = gather ? '255,107,53' : {
    signal: '255,107,53',
    sky: '55,182,255',
    pink: '255,68,196',
    cyan: '51,224,214',
    success: '74,222,128',
    sun: '255,216,77',
    plum: '169,123,255',
    neutral: '108,115,127'
  }[color] || '255,68,196';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      width: size,
      height: size,
      ...style
    }
  }, pulse && /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      left: '50%',
      top: '50%',
      width: size * 1.9,
      height: size * 1.9,
      transform: 'translate(-50%,-50%)',
      borderRadius: '50%',
      background: `radial-gradient(circle, rgba(${cRaw},0.35) 0%, rgba(${cRaw},0) 70%)`
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      width: size,
      height: size,
      borderRadius: '50% 50% 50% 4px',
      transform: 'rotate(45deg)',
      background: c,
      border: '3px solid #fff',
      boxShadow: `0 4px 14px rgba(0,0,0,0.45), 0 0 18px rgba(${cRaw},0.5)`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      transform: 'rotate(-45deg)',
      fontSize: size * 0.5,
      lineHeight: 1,
      fontFamily: 'var(--font-display)',
      fontWeight: 'var(--fw-bold)',
      color: '#0A0A0C'
    }
  }, gather ? '🚩' : emoji || (label ? label.slice(0, 1) : ''))));
}
Object.assign(__ds_scope, { MemberMarker });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/hither/MemberMarker.jsx", error: String((e && e.message) || e) }); }

// components/hither/MemberRow.jsx
try { (() => {
/**
 * MemberRow — one person in the members list: avatar, name, status line, and a
 * trailing time/distance readout. `you` and `leader` add the accent treatments.
 */
function MemberRow({
  emoji,
  label,
  name,
  color = 'sky',
  status = '未出發',
  time = null,
  distance = null,
  you = false,
  leader = false,
  statusTone = 'muted',
  divider = false,
  style = {}
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 14,
      padding: '12px 4px',
      borderTop: divider ? '1px solid var(--glass-edge)' : 'none',
      ...style
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.Avatar, {
    emoji: emoji,
    label: label || name,
    color: leader ? 'success' : color,
    size: 46,
    ring: true,
    leader: leader,
    dimmed: false
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--font-display)',
      fontWeight: 'var(--fw-semibold)',
      fontSize: 'var(--text-title)',
      color: 'var(--text-primary)'
    }
  }, name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 'var(--text-footnote)',
      fontWeight: 'var(--fw-medium)',
      marginTop: 2,
      color: statusTone === 'success' ? 'var(--success)' : 'var(--text-muted)'
    }
  }, status)), you ? /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-muted)',
      fontSize: 'var(--text-callout)',
      fontWeight: 'var(--fw-medium)'
    }
  }, "\u4F60") : time && /*#__PURE__*/React.createElement(__ds_scope.DistanceChip, {
    time: time,
    distance: distance,
    size: "md"
  }));
}
Object.assign(__ds_scope, { MemberRow });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/hither/MemberRow.jsx", error: String((e && e.message) || e) }); }

// components/hither/ProgressDots.jsx
try { (() => {
/**
 * ProgressDots — onboarding step indicator (Duolingo-style). The active step is
 * a stretched accent capsule; the rest are muted dots.
 */
function ProgressDots({
  total = 4,
  active = 0,
  style = {}
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      ...style
    }
  }, Array.from({
    length: total
  }).map((_, i) => {
    const on = i === active;
    const done = i < active;
    return /*#__PURE__*/React.createElement("span", {
      key: i,
      style: {
        height: 8,
        width: on ? 26 : 8,
        borderRadius: 'var(--radius-pill)',
        background: on ? 'var(--accent)' : done ? 'var(--accent-press)' : 'var(--ink-600)',
        boxShadow: on ? 'var(--glow-accent)' : 'none',
        transition: 'width var(--dur-base) var(--ease-spring), background var(--dur-base)'
      }
    });
  }));
}
Object.assign(__ds_scope, { ProgressDots });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/hither/ProgressDots.jsx", error: String((e && e.message) || e) }); }

// components/hither/RolePill.jsx
try { (() => {
/**
 * RolePill — floating glass status pill (top-right): a colored status dot plus
 * the current role ("隊長" / Leader, "隊員" / Follower). Green dot = live/tracking.
 */
function RolePill({
  label = '隊長',
  dotColor = 'var(--grass-500)',
  onClick,
  style = {}
}) {
  return /*#__PURE__*/React.createElement("button", {
    onClick: onClick,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '8px',
      height: 46,
      padding: '0 18px',
      border: '1px solid var(--glass-edge)',
      background: 'var(--glass-fill)',
      backdropFilter: 'var(--glass-blur)',
      WebkitBackdropFilter: 'var(--glass-blur)',
      borderRadius: 'var(--radius-pill)',
      boxShadow: 'var(--glass-shadow), var(--glass-inner-hi)',
      cursor: 'pointer',
      WebkitTapHighlightColor: 'transparent',
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 9,
      height: 9,
      borderRadius: '50%',
      background: dotColor,
      boxShadow: `0 0 8px ${dotColor}`
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--font-display)',
      fontWeight: 'var(--fw-semibold)',
      fontSize: 'var(--text-title)',
      color: 'var(--text-primary)'
    }
  }, label));
}
Object.assign(__ds_scope, { RolePill });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/hither/RolePill.jsx", error: String((e && e.message) || e) }); }

// ui_kits/hither_ios/FollowerNav.jsx
try { (() => {
/* Hither iOS kit — Follower navigation view (which way, how far). */
(function () {
  const NS = window.HitherDesignSystem_fea0fc;
  const {
    GlassSurface,
    RolePill,
    GroupChip,
    MemberMarker,
    DistanceChip,
    Button
  } = NS;
  function FollowerNav({
    onOpenSheet
  }) {
    return /*#__PURE__*/React.createElement("div", {
      style: {
        position: 'absolute',
        inset: 0
      }
    }, /*#__PURE__*/React.createElement(MapBg, null, /*#__PURE__*/React.createElement("svg", {
      viewBox: "0 0 390 700",
      style: {
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%'
      }
    }, /*#__PURE__*/React.createElement("path", {
      d: "M195 470 C 210 380, 170 320, 200 250",
      fill: "none",
      stroke: "var(--accent)",
      strokeWidth: "5",
      strokeLinecap: "round",
      strokeDasharray: "2 16",
      opacity: "0.9"
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        position: 'absolute',
        left: '50%',
        top: '34%',
        transform: 'translate(-50%,-100%)'
      }
    }, /*#__PURE__*/React.createElement(MemberMarker, {
      gather: true,
      color: "signal",
      size: 52,
      pulse: true
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        position: 'absolute',
        left: '50%',
        top: '66%',
        transform: 'translate(-50%,-50%)'
      }
    }, /*#__PURE__*/React.createElement(MemberMarker, {
      emoji: "\uD83E\uDD8A",
      color: "sky",
      size: 50,
      pulse: true
    }))), /*#__PURE__*/React.createElement("div", {
      style: {
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column'
      }
    }, /*#__PURE__*/React.createElement(StatusBar, null), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        padding: '4px 16px'
      }
    }, /*#__PURE__*/React.createElement(GroupChip, {
      name: "\u677E\u5C71\u6236",
      count: 4,
      members: [{
        emoji: '⚽️',
        color: 'success'
      }, {
        emoji: '🐑',
        color: 'signal'
      }, {
        emoji: '🦊',
        color: 'sky'
      }],
      onClick: onOpenSheet
    }), /*#__PURE__*/React.createElement(RolePill, {
      label: "\u968A\u54E1",
      dotColor: "var(--sky-500)"
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1
      }
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        padding: '0 12px 22px'
      }
    }, /*#__PURE__*/React.createElement(GlassSurface, {
      variant: "sheet",
      weight: "heavy",
      tint: null,
      style: {
        borderRadius: 'var(--radius-2xl)',
        padding: 22
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 16
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 46,
        transform: 'rotate(-20deg)'
      }
    }, "\u27A4"), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontFamily: 'var(--font-ui)',
        fontWeight: 600,
        fontSize: 14,
        color: 'var(--text-secondary)'
      }
    }, "\u524D\u5F80\u96C6\u5408\u9EDE \xB7 \u6B63\u9580\u53E3"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'baseline',
        gap: 10,
        marginTop: 2
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: 'var(--font-display)',
        fontWeight: 700,
        fontSize: 44,
        color: 'var(--accent)',
        lineHeight: 1
      }
    }, "4 min"), /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: 'var(--font-display)',
        fontWeight: 600,
        fontSize: 18,
        color: 'var(--text-muted)'
      }
    }, "\xB7 323 m")))), /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      full: true,
      style: {
        marginTop: 18
      },
      iconLeft: "\uD83E\uDDED"
    }, "\u958B\u59CB\u5C0E\u822A")))));
  }
  window.FollowerNav = FollowerNav;
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/hither_ios/FollowerNav.jsx", error: String((e && e.message) || e) }); }

// ui_kits/hither_ios/MapHome.jsx
try { (() => {
/* Hither iOS kit — Leader map home. Matches the live app's primary view. */
(function () {
  const NS = window.HitherDesignSystem_fea0fc;
  const {
    GroupChip,
    RolePill,
    MapControl,
    MemberMarker,
    GlassSurface,
    Avatar
  } = NS;
  const members = [{
    emoji: '⚽️',
    color: 'success'
  }, {
    emoji: '🐑',
    color: 'signal'
  }, {
    emoji: '🦊',
    color: 'sky'
  }];
  function MapHome({
    onOpenSheet,
    onSetGather
  }) {
    return /*#__PURE__*/React.createElement("div", {
      style: {
        position: 'absolute',
        inset: 0
      }
    }, /*#__PURE__*/React.createElement(MapBg, null, /*#__PURE__*/React.createElement("div", {
      style: {
        position: 'absolute',
        left: '30%',
        top: '40%'
      }
    }, /*#__PURE__*/React.createElement(MemberMarker, {
      emoji: "\uD83D\uDC11",
      color: "signal",
      size: 44
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        position: 'absolute',
        left: '58%',
        top: '52%'
      }
    }, /*#__PURE__*/React.createElement(MemberMarker, {
      emoji: "\uD83E\uDD8A",
      color: "sky",
      size: 44,
      pulse: true
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        position: 'absolute',
        left: '44%',
        top: '61%'
      }
    }, /*#__PURE__*/React.createElement(MemberMarker, {
      emoji: "\uD83D\uDC30",
      color: "plum",
      size: 44
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        position: 'absolute',
        left: '48%',
        top: '30%'
      }
    }, /*#__PURE__*/React.createElement(MemberMarker, {
      gather: true,
      color: "signal",
      size: 50,
      pulse: true
    }))), /*#__PURE__*/React.createElement("div", {
      style: {
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column'
      }
    }, /*#__PURE__*/React.createElement(StatusBar, null), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        padding: '4px 16px'
      }
    }, /*#__PURE__*/React.createElement(GroupChip, {
      name: "\u677E\u5C71\u6236",
      count: 4,
      members: members,
      onClick: onOpenSheet
    }), /*#__PURE__*/React.createElement(RolePill, {
      label: "\u968A\u9577"
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1
      }
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        justifyContent: 'flex-end',
        padding: '0 16px 12px'
      }
    }, /*#__PURE__*/React.createElement(MapControl, {
      items: [{
        icon: '⤢'
      }, {
        icon: '➤',
        active: true
      }]
    })), /*#__PURE__*/React.createElement(AppleMapsTag, null), /*#__PURE__*/React.createElement("div", {
      onClick: onOpenSheet,
      style: {
        padding: '0 12px 22px',
        cursor: 'pointer'
      }
    }, /*#__PURE__*/React.createElement(GlassSurface, {
      variant: "pane",
      weight: "heavy",
      style: {
        borderRadius: 'var(--radius-2xl) var(--radius-2xl) 24px 24px',
        padding: '10px 14px 18px'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        width: 40,
        height: 5,
        borderRadius: 3,
        background: 'rgba(255,255,255,0.35)',
        margin: '2px auto 14px'
      }
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 12
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        height: 46,
        padding: '0 16px',
        background: 'rgba(255,255,255,0.10)',
        borderRadius: 'var(--radius-pill)'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--text-muted)'
      }
    }, "\uD83D\uDD0D"), /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--text-muted)',
        fontFamily: 'var(--font-ui)',
        fontWeight: 500
      }
    }, "\u641C\u5C0B\u5730\u9EDE")), /*#__PURE__*/React.createElement(Avatar, {
      emoji: "\u26BD\uFE0F",
      color: "neutral",
      size: 46,
      ring: false
    }))))));
  }
  window.MapHome = MapHome;
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/hither_ios/MapHome.jsx", error: String((e && e.message) || e) }); }

// ui_kits/hither_ios/MembersSheet.jsx
try { (() => {
/* Hither iOS kit — Members / group sheet (matches live app screens 2 & 3). */
(function () {
  const NS = window.HitherDesignSystem_fea0fc;
  const {
    GroupChip,
    RolePill,
    MemberRow,
    Switch,
    GlassSurface,
    Avatar,
    Button,
    GatherPointRow
  } = NS;
  function SheetHeader() {
    return /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        marginBottom: 4
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        height: 46,
        padding: '0 16px',
        background: 'rgba(255,255,255,0.10)',
        borderRadius: 'var(--radius-pill)'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--text-muted)'
      }
    }, "\uD83D\uDD0D"), /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--text-muted)',
        fontFamily: 'var(--font-ui)',
        fontWeight: 500
      }
    }, "\u641C\u5C0B\u5730\u9EDE")), /*#__PURE__*/React.createElement(Avatar, {
      emoji: "\u26BD\uFE0F",
      color: "neutral",
      size: 46,
      ring: false
    }));
  }
  function SectionTitle({
    children,
    right
  }) {
    return /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        margin: '22px 2px 12px'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: 'var(--font-display)',
        fontWeight: 700,
        fontSize: 'var(--text-display-md)',
        color: 'var(--text-primary)'
      }
    }, children), right && /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: 'var(--font-ui)',
        fontSize: 'var(--text-footnote)',
        color: 'var(--text-muted)',
        fontWeight: 500
      }
    }, right));
  }
  function MembersSheet({
    onClose,
    onSetGather
  }) {
    const [solo, setSolo] = React.useState(false);
    return /*#__PURE__*/React.createElement("div", {
      style: {
        position: 'absolute',
        inset: 0
      }
    }, /*#__PURE__*/React.createElement(MapBg, null), /*#__PURE__*/React.createElement("div", {
      style: {
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column'
      }
    }, /*#__PURE__*/React.createElement(StatusBar, null), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        justifyContent: 'space-between',
        padding: '4px 16px 0'
      }
    }, /*#__PURE__*/React.createElement(GroupChip, {
      name: "\u677E\u5C71\u6236",
      count: 4,
      members: [{
        emoji: '⚽️',
        color: 'success'
      }, {
        emoji: '🐑',
        color: 'signal'
      }, {
        emoji: '🦊',
        color: 'sky'
      }]
    }), /*#__PURE__*/React.createElement(RolePill, {
      label: "\u968A\u9577"
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1
      }
    }), /*#__PURE__*/React.createElement(GlassSurface, {
      variant: "sheet",
      weight: "heavy",
      style: {
        borderRadius: 'var(--radius-2xl) var(--radius-2xl) 0 0',
        padding: '10px 20px 26px',
        maxHeight: '74%',
        overflowY: 'auto'
      }
    }, /*#__PURE__*/React.createElement("div", {
      onClick: onClose,
      style: {
        width: 40,
        height: 5,
        borderRadius: 3,
        background: 'rgba(255,255,255,0.35)',
        margin: '2px auto 16px',
        cursor: 'pointer'
      }
    }), /*#__PURE__*/React.createElement(SheetHeader, null), /*#__PURE__*/React.createElement(SectionTitle, {
      right: "\u514D\u8CBB\u7248\u4E0A\u9650 4 \u4EBA"
    }, "\u6210\u54E1 \xB7 4"), /*#__PURE__*/React.createElement("div", {
      style: {
        background: 'rgba(255,255,255,0.05)',
        borderRadius: 'var(--radius-lg)',
        padding: '4px 14px'
      }
    }, /*#__PURE__*/React.createElement(MemberRow, {
      emoji: "\u26BD\uFE0F",
      name: "sudjnd",
      leader: true,
      status: "\u9818\u968A\u4E2D",
      statusTone: "success",
      you: true
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '10px 4px',
        borderTop: '1px solid var(--glass-edge)'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        gap: 14
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--text-muted)',
        fontFamily: 'var(--font-ui)',
        fontWeight: 500
      }
    }, "\u7368\u81EA\u884C\u52D5"), /*#__PURE__*/React.createElement(Switch, {
      checked: solo,
      onChange: setSolo
    })), /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--success)',
        fontWeight: 700,
        fontFamily: 'var(--font-display)'
      }
    }, "\u5EFA\u7ACB\u5C0F\u968A")), /*#__PURE__*/React.createElement(MemberRow, {
      emoji: "\uD83D\uDC11",
      name: "\u5C0F\u7F8A",
      color: "signal",
      status: "\u672A\u51FA\u767C",
      time: "3 min",
      distance: "273 m",
      divider: true
    }), /*#__PURE__*/React.createElement(MemberRow, {
      emoji: "\uD83E\uDD8A",
      name: "\u963F\u798F",
      color: "sky",
      status: "\u672A\u51FA\u767C",
      time: "4 min",
      distance: "323 m",
      divider: true
    }), /*#__PURE__*/React.createElement(MemberRow, {
      emoji: "\uD83D\uDC30",
      name: "\u5947\u5947",
      color: "plum",
      status: "\u672A\u51FA\u767C",
      time: "3 min",
      distance: "243 m",
      divider: true
    })), /*#__PURE__*/React.createElement(SectionTitle, null, "\u7FA4\u7D44\u4EE3\u78BC"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between'
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: 'var(--font-display)',
        fontWeight: 700,
        fontSize: 40,
        letterSpacing: 2,
        color: 'var(--text-primary)'
      }
    }, "4WBNC7"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: 10
      }
    }, /*#__PURE__*/React.createElement(Button, {
      variant: "success",
      size: "sm",
      iconLeft: "\uDBC0\uDE02"
    }, "\u5206\u4EAB"), /*#__PURE__*/React.createElement(Button, {
      variant: "ghost",
      size: "sm"
    }, "\u8907\u88FD"))), /*#__PURE__*/React.createElement(SectionTitle, null, "\u96C6\u5408\u9EDE"), /*#__PURE__*/React.createElement(GatherPointRow, {
      icon: "\uD83D\uDEA9",
      title: "0 \u500B\u96C6\u5408\u9EDE \xB7 \u8ABF\u6574\u9806\u5E8F",
      trailing: /*#__PURE__*/React.createElement("span", {
        style: {
          color: 'var(--accent)',
          fontWeight: 700,
          fontFamily: 'var(--font-display)'
        }
      }, "\u7DE8\u8F2F"),
      onClick: onSetGather
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        height: 12
      }
    }), /*#__PURE__*/React.createElement(GatherPointRow, {
      icon: "\uD83D\uDCC4",
      tileTone: "sky",
      title: "\u532F\u5165 KML",
      trailing: /*#__PURE__*/React.createElement("span", {
        style: {
          color: 'var(--text-muted)',
          fontSize: 20
        }
      }, "\u203A")
    }))));
  }
  window.MembersSheet = MembersSheet;
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/hither_ios/MembersSheet.jsx", error: String((e && e.message) || e) }); }

// ui_kits/hither_ios/Onboarding.jsx
try { (() => {
/* Hither iOS kit — Onboarding (Duolingo-style warmth, Apple-clean structure). */
(function () {
  const NS = window.HitherDesignSystem_fea0fc;
  const {
    Button,
    ProgressDots,
    GlassSurface,
    MemberMarker
  } = NS;
  const STEPS = [{
    hero: '🐑',
    beacon: true,
    title: '把走散的夥伴\n重新聚在一起',
    body: '你就是牧羊人。規劃路線、設定集合點，讓每個人都知道往哪走。'
  }, {
    hero: '🚩',
    beacon: false,
    title: '一秒設定\n下一個集合點',
    body: '在地圖上點一下，所有隊員立即收到方向與距離。'
  }, {
    hero: '🧭',
    beacon: false,
    title: '還差多遠？\n一眼就知道',
    body: '每位隊員都看得到直線距離與預估步行時間。不再走丟。'
  }];
  function Onboarding({
    onDone
  }) {
    const [step, setStep] = React.useState(0);
    const s = STEPS[step];
    const next = () => step < STEPS.length - 1 ? setStep(step + 1) : onDone();
    return /*#__PURE__*/React.createElement("div", {
      style: {
        position: 'absolute',
        inset: 0,
        background: 'radial-gradient(120% 80% at 50% 0%, #23305c 0%, var(--bg-app) 60%)',
        display: 'flex',
        flexDirection: 'column'
      }
    }, /*#__PURE__*/React.createElement(StatusBar, null), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 34px',
        textAlign: 'center'
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        position: 'relative',
        marginBottom: 40
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 108,
        lineHeight: 1,
        filter: 'drop-shadow(0 12px 30px rgba(0,0,0,0.5))'
      }
    }, s.hero), s.beacon && /*#__PURE__*/React.createElement("div", {
      style: {
        position: 'absolute',
        right: -18,
        top: -10
      }
    }, /*#__PURE__*/React.createElement(MemberMarker, {
      gather: true,
      color: "signal",
      size: 46,
      pulse: true
    }))), /*#__PURE__*/React.createElement("h1", {
      style: {
        fontFamily: 'var(--font-display)',
        fontWeight: 700,
        fontSize: 34,
        lineHeight: 1.12,
        letterSpacing: '-0.02em',
        color: 'var(--text-primary)',
        margin: 0,
        whiteSpace: 'pre-line'
      }
    }, s.title), /*#__PURE__*/React.createElement("p", {
      style: {
        fontFamily: 'var(--font-ui)',
        fontWeight: 500,
        fontSize: 16,
        lineHeight: 1.5,
        color: 'var(--text-secondary)',
        marginTop: 18,
        maxWidth: 300
      }
    }, s.body)), /*#__PURE__*/React.createElement("div", {
      style: {
        padding: '0 24px 40px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 24
      }
    }, /*#__PURE__*/React.createElement(ProgressDots, {
      total: STEPS.length,
      active: step
    }), /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      full: true,
      onClick: next
    }, step < STEPS.length - 1 ? '繼續' : '開始使用')));
  }
  window.Onboarding = Onboarding;
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/hither_ios/Onboarding.jsx", error: String((e && e.message) || e) }); }

// ui_kits/hither_ios/SetGatherPoint.jsx
try { (() => {
/* Hither iOS kit — Set gather point (leader drops the next beacon). */
(function () {
  const NS = window.HitherDesignSystem_fea0fc;
  const {
    GlassSurface,
    Button,
    MemberMarker,
    Input,
    Banner,
    IconButton
  } = NS;
  function SetGatherPoint({
    onCancel,
    onConfirm
  }) {
    return /*#__PURE__*/React.createElement("div", {
      style: {
        position: 'absolute',
        inset: 0
      }
    }, /*#__PURE__*/React.createElement(MapBg, null), /*#__PURE__*/React.createElement("div", {
      style: {
        position: 'absolute',
        left: '50%',
        top: '42%',
        transform: 'translate(-50%,-100%)'
      }
    }, /*#__PURE__*/React.createElement(MemberMarker, {
      gather: true,
      color: "signal",
      size: 60,
      pulse: true
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        position: 'absolute',
        inset: 0,
        display: 'flex',
        flexDirection: 'column'
      }
    }, /*#__PURE__*/React.createElement(StatusBar, null), /*#__PURE__*/React.createElement("div", {
      style: {
        padding: '4px 16px'
      }
    }, /*#__PURE__*/React.createElement(GlassSurface, {
      variant: "pill",
      style: {
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '12px 18px'
      }
    }, /*#__PURE__*/React.createElement(IconButton, {
      tone: "glass",
      size: 30,
      onClick: onCancel
    }, "\u2039"), /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: 'var(--font-display)',
        fontWeight: 600,
        fontSize: 17
      }
    }, "\u8A2D\u5B9A\u96C6\u5408\u9EDE"))), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1
      }
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        padding: '0 12px 22px'
      }
    }, /*#__PURE__*/React.createElement(GlassSurface, {
      variant: "sheet",
      weight: "heavy",
      style: {
        borderRadius: 'var(--radius-2xl)',
        padding: 20
      }
    }, /*#__PURE__*/React.createElement(Banner, {
      tone: "signal",
      icon: "\uD83D\uDEA9",
      style: {
        marginBottom: 16
      }
    }, "\u62D6\u52D5\u5730\u5716\uFF0C\u628A\u5927\u982D\u91DD\u5C0D\u6E96\u96C6\u5408\u5730\u9EDE"), /*#__PURE__*/React.createElement(Input, {
      iconLeft: "\uD83D\uDCCD",
      placeholder: "\u5E6B\u9019\u500B\u96C6\u5408\u9EDE\u53D6\u500B\u540D\u5B57\uFF08\u4F8B\u5982\uFF1A\u6B63\u9580\u53E3\uFF09",
      style: {
        marginBottom: 16
      }
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        gap: 12
      }
    }, /*#__PURE__*/React.createElement(Button, {
      variant: "ghost",
      full: true,
      onClick: onCancel
    }, "\u53D6\u6D88"), /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      full: true,
      onClick: onConfirm,
      iconLeft: "\uD83D\uDEA9"
    }, "\u901A\u77E5\u6240\u6709\u968A\u54E1"))))));
  }
  window.SetGatherPoint = SetGatherPoint;
})();
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/hither_ios/SetGatherPoint.jsx", error: String((e && e.message) || e) }); }

// ui_kits/hither_ios/frame.jsx
try { (() => {
/* Hither iOS kit — shared frame + basemap helpers. Exposed on window. */
const {
  useState
} = React;
function StatusBar({
  dark = false
}) {
  const c = dark ? '#0A0A0C' : '#fff';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '14px 26px 6px',
      fontFamily: 'var(--font-ui)',
      color: c,
      fontWeight: 700,
      fontSize: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("span", null, "14:40"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13
    }
  }, "\u27A4")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 7,
      fontSize: 15
    }
  }, /*#__PURE__*/React.createElement("span", null, "\u2582\u2584\u2586"), /*#__PURE__*/React.createElement("span", null, "\uDBC1\uDE47"), /*#__PURE__*/React.createElement("span", {
    style: {
      border: `2px solid ${c}`,
      borderRadius: 5,
      padding: '1px 4px',
      fontSize: 11,
      fontWeight: 800
    }
  }, "99")));
}

/* Apple-Maps-style dark navy basemap with faint islands + a POI + member pins */
function MapBg({
  children,
  style = {}
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      inset: 0,
      background: 'radial-gradient(130% 100% at 25% 8%, #1e386b 0%, #16264a 42%, #101b36 100%)',
      overflow: 'hidden',
      ...style
    }
  }, /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 390 700",
    preserveAspectRatio: "xMidYMid slice",
    style: {
      position: 'absolute',
      inset: 0,
      width: '100%',
      height: '100%',
      opacity: 0.5
    }
  }, /*#__PURE__*/React.createElement("path", {
    d: "M120 470 q40 -30 90 -10 q50 20 70 5 q30 -22 -5 -45 q-60 -25 -120 0 q-55 25 -35 55z",
    fill: "#22c55e",
    opacity: "0.28"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M40 520 q20 -12 45 -4 q10 20 -12 26 q-40 6 -33 -22z",
    fill: "#22c55e",
    opacity: "0.2"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M260 430 q22 -14 40 -2 q8 18 -14 24 q-34 4 -26 -22z",
    fill: "#22c55e",
    opacity: "0.22"
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      left: '52%',
      top: '66%',
      fontFamily: 'var(--font-ui)',
      color: '#8fb98f',
      fontSize: 12,
      fontWeight: 600
    }
  }, "\uD83C\uDF32 \u897F\u8868\u77F3\u57A3\u570B\u7ACB\u516C\u5712"), /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      right: '10%',
      top: '58%',
      fontFamily: 'var(--font-ui)',
      color: '#6a7fae',
      fontSize: 15,
      fontWeight: 700,
      letterSpacing: 4,
      transform: 'rotate(-18deg)'
    }
  }, "\u5148\u5CF6\u7FA4\u5CF6"), children);
}
function AppleMapsTag() {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      left: 20,
      bottom: 138,
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      color: 'rgba(255,255,255,0.85)',
      fontFamily: 'var(--font-ui)',
      fontWeight: 700,
      fontSize: 15
    }
  }, "Maps ", /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 500,
      fontSize: 12,
      textDecoration: 'underline',
      color: 'rgba(255,255,255,0.5)'
    }
  }, "Legal"));
}

/* iPhone frame — rounded screen, notch, home indicator */
function PhoneFrame({
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      width: 390,
      height: 844,
      borderRadius: 54,
      background: '#000',
      padding: 5,
      boxShadow: '0 40px 90px rgba(0,0,0,0.55)',
      position: 'relative',
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: '100%',
      height: '100%',
      borderRadius: 49,
      overflow: 'hidden',
      position: 'relative',
      background: 'var(--bg-app)'
    }
  }, children, /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      left: '50%',
      bottom: 8,
      transform: 'translateX(-50%)',
      width: 134,
      height: 5,
      borderRadius: 3,
      background: 'rgba(255,255,255,0.6)',
      zIndex: 50
    }
  })));
}
Object.assign(window, {
  StatusBar,
  MapBg,
  AppleMapsTag,
  PhoneFrame
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/hither_ios/frame.jsx", error: String((e && e.message) || e) }); }

__ds_ns.Avatar = __ds_scope.Avatar;

__ds_ns.Banner = __ds_scope.Banner;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.IconButton = __ds_scope.IconButton;

__ds_ns.Pill = __ds_scope.Pill;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.Segmented = __ds_scope.Segmented;

__ds_ns.Switch = __ds_scope.Switch;

__ds_ns.GlassSurface = __ds_scope.GlassSurface;

__ds_ns.DistanceChip = __ds_scope.DistanceChip;

__ds_ns.GatherPointRow = __ds_scope.GatherPointRow;

__ds_ns.GroupChip = __ds_scope.GroupChip;

__ds_ns.MapControl = __ds_scope.MapControl;

__ds_ns.MemberMarker = __ds_scope.MemberMarker;

__ds_ns.MemberRow = __ds_scope.MemberRow;

__ds_ns.ProgressDots = __ds_scope.ProgressDots;

__ds_ns.RolePill = __ds_scope.RolePill;

})();
