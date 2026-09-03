import { useState } from 'react'
import type { InputHTMLAttributes } from 'react'
import { Icon } from './Icon'

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  visibilityLabel?: string
}

export function PasswordInput({ visibilityLabel = 'password', ...inputProps }: PasswordInputProps) {
  const [visible, setVisible] = useState(false)

  return (
    <div className="password-input">
      <input {...inputProps} type={visible ? 'text' : 'password'} />
      <button
        aria-label={`${visible ? 'Hide' : 'Show'} ${visibilityLabel}`}
        aria-pressed={visible}
        className="password-input__toggle"
        onClick={() => setVisible((current) => !current)}
        title={`${visible ? 'Hide' : 'Show'} ${visibilityLabel}`}
        type="button"
      >
        <Icon name={visible ? 'eye-off' : 'eye'} />
      </button>
    </div>
  )
}
