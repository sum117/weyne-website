"""Validate the CNPJ currently shipped in src/features/landing/content.ts."""


def cnpj_check_digits(base: str) -> str:
    def digit(nums, weights):
        total = sum(int(n) * w for n, w in zip(nums, weights))
        rest = total % 11
        return "0" if rest < 2 else str(11 - rest)

    w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    w2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    d1 = digit(base, w1)
    d2 = digit(base + d1, w2)
    return d1 + d2


value = "05.095.383/0001-42"
digits = "".join(c for c in value if c.isdigit())
base, given = digits[:12], digits[12:]
expected = cnpj_check_digits(base)
print(f"value           {value}")
print(f"digits          {digits} (len {len(digits)})")
print(f"given check     {given}")
print(f"expected check  {expected}")
print(f"structurally valid: {given == expected}")
