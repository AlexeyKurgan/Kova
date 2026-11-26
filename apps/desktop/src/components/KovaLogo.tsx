type Props = { size?: number; className?: string };

export default function KovaLogo({ size = 32, className = "" }: Props) {
  return (
    <svg
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="Kova Hub Logo"
      className={className}
    >
      <path d="M6.2 14.4L5.2 6.6C5 5.2 6.4 4.3 7.6 5.1L12.4 8.6C14.7 7.9 17.3 7.9 19.6 8.6L24.4 5.1C25.6 4.3 27 5.2 26.8 6.6L25.8 14.4C26.9 16.2 27.2 18.7 26.3 21.1C24.8 25.1 20.8 27.4 16 27.4C11.2 27.4 7.2 25.1 5.7 21.1C4.8 18.7 5.1 16.2 6.2 14.4Z" fill="#232B39" stroke="#E2AE4E" strokeWidth="2" strokeLinejoin="round" />
      <path d="M8.3 12.1L7.8 8.3L10.9 10.4Z" fill="#4C3D31" />
      <path d="M23.7 12.1L24.2 8.3L21.1 10.4Z" fill="#4C3D31" />
      <circle cx="12.1" cy="16.8" r="2.1" fill="#E5B254" />
      <circle cx="12.1" cy="16.8" r="1.05" fill="#171C26" />
      <circle cx="19.9" cy="16.8" r="2.1" fill="#E5B254" />
      <circle cx="19.9" cy="16.8" r="1.05" fill="#171C26" />
      <path d="M14.7 20.1H17.3L16 21.8Z" fill="#E2AE4E" />
      <path d="M16 24.8L18.1 27L16 29.2L13.9 27Z" fill="#E2AE4E" />
    </svg>
  );
}
