import { useId, useState } from 'react'
import type { InputHTMLAttributes } from 'react'
import { Icon } from './Icon'

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  label: string
  visibilityLabel?: string
}

export function PasswordInput({ label, visibilityLabel = 'password', ...inputProps }: PasswordInputProps) {
  const [visible, setVisible] = useState(false)
  const generatedId = useId()
  const inputId = inputProps.id ?? generatedId

  return (
    <div className="password-field">
      <label htmlFor={inputId}>{label}</label>
      <div className="password-input">
        <input {...inputProps} id={inputId} type={visible ? 'text' : 'password'} />
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
    </div>
  )
}
