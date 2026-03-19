import { useState, useCallback } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import LandingPage from './components/LandingPage';
import DashboardView from './components/DashboardView';
import './styles.css';

function App() {
  const [entered, setEntered] = useState(false);

  return (
    <AnimatePresence mode="wait">
      {!entered ? (
        <motion.div key="landing" exit={{ opacity: 0 }} transition={{ duration: 0.5 }}>
          <LandingPage onEnter={() => setEntered(true)} />
        </motion.div>
      ) : (
        <motion.div
          key="world"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6 }}
          style={{ height: '100vh', width: '100vw' }}
        >
          <DashboardView />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export default App;
