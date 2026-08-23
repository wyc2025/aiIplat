/** 表单常用校验规则（供 Element Plus form rules 使用） */

/** 密码：8~32 位，必须含字母和数字 */
export const PASSWORD_REGEX = /^(?=.*[A-Za-z])(?=.*\d)\S{8,32}$/

export function isPassword(value: string): boolean {
  return PASSWORD_REGEX.test(value)
}

export function isPhone(value: string): boolean {
  return /^1\d{10}$/.test(value)
}

export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}
