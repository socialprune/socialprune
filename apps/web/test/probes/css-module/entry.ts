import styles from './sample.module.css';

const root = document.getElementById('root');
if (!root) throw new Error('Missing test root.');
root.className = styles.sample ?? '';
root.textContent = 'CSS Module test';
