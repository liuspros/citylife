import './globals.css';
export const metadata = { title: 'Naija City', description: 'A multiplayer Lagos-style city life game' };
export default function RootLayout({ children }) {
  return (<html lang="en"><body>{children}</body></html>);
}
