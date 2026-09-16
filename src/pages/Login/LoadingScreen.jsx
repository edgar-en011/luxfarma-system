import React from 'react';
import icono from '../../assets/icono.png';
import './LoadingScreen.css';

export default function LoadingScreen() {
  return (
    <div className="loading-fullscreen">

      {/* Estrellas */}
      {[
        { top: '7%',  left: '9%',  size: 2,   dur: '3.2s', delay: '0s',   minOp: 0.15, maxOp: 0.75 },
        { top: '11%', left: '83%', size: 2.5, dur: '4s',   delay: '0.8s', minOp: 0.1,  maxOp: 0.65 },
        { top: '73%', left: '5%',  size: 2,   dur: '3.8s', delay: '1.2s', minOp: 0.2,  maxOp: 0.85 },
        { top: '77%', left: '91%', size: 1.5, dur: '2.8s', delay: '0.4s', minOp: 0.2,  maxOp: 0.9  },
        { top: '34%', left: '3%',  size: 1.5, dur: '5s',   delay: '2s',   minOp: 0.1,  maxOp: 0.55 },
        { top: '27%', left: '95%', size: 2,   dur: '3.5s', delay: '1.5s', minOp: 0.15, maxOp: 0.7  },
        { top: '89%', left: '43%', size: 1.5, dur: '4.2s', delay: '0.6s', minOp: 0.1,  maxOp: 0.5  },
        { top: '4%',  left: '53%', size: 2,   dur: '3s',   delay: '1.8s', minOp: 0.15, maxOp: 0.8  },
        { top: '56%', left: '89%', size: 1.5, dur: '4.5s', delay: '0.9s', minOp: 0.1,  maxOp: 0.6  },
        { top: '47%', left: '1%',  size: 2,   dur: '3.6s', delay: '1.3s', minOp: 0.15, maxOp: 0.7  },
        { top: '19%', left: '46%', size: 1.5, dur: '2.5s', delay: '0.2s', minOp: 0.1,  maxOp: 0.5  },
        { top: '64%', left: '66%', size: 2,   dur: '4.8s', delay: '1.6s', minOp: 0.15, maxOp: 0.7  },
        { top: '42%', left: '75%', size: 1.5, dur: '3.3s', delay: '0.7s', minOp: 0.1,  maxOp: 0.6  },
        { top: '82%', left: '28%', size: 2,   dur: '4s',   delay: '1.1s', minOp: 0.15, maxOp: 0.7  },
      ].map((s, i) => (
        <div key={i} className="loading-star" style={{
          top: s.top, left: s.left,
          width: s.size, height: s.size,
          '--dur': s.dur, '--delay': s.delay,
          '--min-op': s.minOp, '--max-op': s.maxOp,
        }} />
      ))}

      <div className="loading-content">
        {/* Spinner + Logo */}
        <div className="loading-logo-container">
          <img src={icono} alt="Salud Futura" className="loading-logo-large" />
        </div>

        {/* Textos */}
        <h1 className="loading-text">Salud Futura</h1>
        <p className="loading-subtitle">Sistema Integral de Farmacia</p>

        {/* Barra shimmer */}
        <div className="loading-bar-wrap">
          <div className="loading-bar" />
        </div>

        <div className="loading-dots">
          <span /><span /><span /><span /><span />
        </div>
      </div>

    </div>
  );
}