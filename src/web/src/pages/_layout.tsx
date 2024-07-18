import '../styles.css';

import type { ReactNode } from 'react';

// import { Footer } from '../components/footer.js';
// import { Header } from '../components/header.js';

type RootLayoutProps = { children: ReactNode };

export default async function RootLayout({ children }: Readonly<RootLayoutProps>) {
//   const data = await getData();

  return (
    <div className="font-['Nunito']">
      {/* <meta property="description" content={data.description} />
      <link rel="icon" type="image/png" href={data.icon} /> */}
      {/* <Header /> */}
      <main>
        {children}
      </main>
      {/* <Footer /> */}
    </div>
  );
}

// const getData = async () => {
//   const data = {
//     description: 'An internet website!',
//     icon: '/images/favicon.png',
//   };

//   return data;
// };

export const getConfig = async () => {
  return {
    render: 'static',
  };
};
