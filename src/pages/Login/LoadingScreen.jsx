import LogoLuxFarma from '../../components/LogoLuxFarma';
import './LoadingScreen.css';

export default function LoadingScreen() {
  return (
    <div className="loading-fullscreen">
      <div className="loading-scene" aria-hidden="true">
        <div className="login-sun loading-sun">
          <div className="login-sun-rays" />
          <div className="login-sun-core" />
        </div>
        <svg className="loading-hills" viewBox="0 0 800 180" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M0,90 C160,40 280,120 420,70 C560,30 680,100 800,60 L800,180 L0,180 Z" fill="#F07178" opacity="0.45" />
          <path d="M0,120 C180,80 300,140 460,105 C620,70 720,130 800,110 L800,180 L0,180 Z" fill="var(--lf-primary-hover)" />
          <path d="M0,150 C200,125 360,165 520,140 C680,115 760,155 800,145 L800,180 L0,180 Z" fill="var(--lf-primary-dark)" />
        </svg>
      </div>

      <div className="loading-content">
        <div className="loading-logo-container">
          <LogoLuxFarma variant="icon" size={72} color="white" showBadge={false} />
        </div>
        <h1 className="loading-text">LuxFarma</h1>
        <p className="loading-subtitle">Preparando tu sesión…</p>
        <div className="loading-dots">
          <span /><span /><span /><span /><span />
        </div>
      </div>
    </div>
  );
}
