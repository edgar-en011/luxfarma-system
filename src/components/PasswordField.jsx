import { useState } from 'react';
import UiIcon from './UiIcon';
import './PasswordField.css';

/**
 * Input de contraseña con toggle ojo (lucide Eye / EyeOff).
 * Mantiene el mismo contrato value/onChange que un <input type="password">.
 */
export default function PasswordField({
  id,
  value,
  onChange,
  placeholder = '••••••••',
  required = false,
  autoComplete,
  className = '',
  name,
  disabled = false,
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className={`pw-field ${className}`.trim()}>
      <input
        id={id}
        name={name}
        type={visible ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        required={required}
        autoComplete={autoComplete}
        disabled={disabled}
      />
      <button
        type="button"
        className="pw-field-toggle"
        onClick={() => setVisible((v) => !v)}
        tabIndex={-1}
        data-enter-skip="true"
        title={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
        aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
      >
        <UiIcon name={visible ? 'EyeOff' : 'Eye'} size={16} />
      </button>
    </div>
  );
}
