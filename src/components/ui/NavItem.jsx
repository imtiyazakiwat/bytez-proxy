export default function NavItem({ icon, label, tab, active, onClick }) {
  return (
    <a 
      href={`#${tab}`} 
      className={`nav-item ${active ? 'active' : ''}`} 
      onClick={(e) => { e.preventDefault(); onClick(); }}
    >
      {icon}
      <span>{label}</span>
    </a>
  );
}
