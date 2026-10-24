const LINKS = [
  { href: 'https://twitter.com/RobertHill352', icon: '/icons/twitter.svg', label: 'Robert Hill on Twitter' },
  { href: 'https://github.com/thathillguy', icon: '/icons/github.svg', label: 'thathillguy on GitHub' },
  { href: 'https://www.linkedin.com/in/robert-hill-470068a8/', icon: '/icons/linkedin.svg', label: 'Robert Hill on LinkedIn' },
];

export default function HeaderBar() {
  return (
    <header className="headerbar">
      {LINKS.map(({ href, icon, label }) => (
        <a key={href} href={href} aria-label={label} rel="me noopener">
          <img src={icon} alt="" width="32" height="32" />
        </a>
      ))}
    </header>
  );
}
