import type { Subject } from '../types'

export const SYLLABUS: Record<Subject, string[]> = {
  Physics: [
    'Units & Measurements', 'Kinematics', 'Laws of Motion', 'Work Energy Power', 'Rotational Motion',
    'Gravitation', 'Properties of Solids & Liquids', 'Thermodynamics', 'Kinetic Theory', 'Oscillations & Waves',
    'Electrostatics', 'Current Electricity', 'Magnetism & Moving Charges', 'EMI & AC', 'EM Waves',
    'Ray & Wave Optics', 'Dual Nature', 'Atoms & Nuclei', 'Semiconductors', 'Experimental Skills'
  ],
  Chemistry: [
    'Mole Concept', 'Atomic Structure', 'Chemical Bonding', 'Chemical Thermodynamics', 'Equilibrium',
    'Redox & Electrochemistry', 'Solutions', 'Chemical Kinetics', 'Periodic Table', 'p-Block', 'd & f Block',
    'Coordination Compounds', 'Metallurgy & Hydrogen', 's-Block', 'GOC', 'Hydrocarbons',
    'Haloalkanes & Haloarenes', 'Alcohols Phenols Ethers', 'Aldehydes & Ketones',
    'Carboxylic Acids & Amines', 'Biomolecules & Polymers', 'Practical Chemistry'
  ],
  Maths: [
    'Sets & Relations', 'Functions', 'Complex Numbers', 'Quadratic Equations', 'Matrices & Determinants',
    'Permutations & Combinations', 'Binomial Theorem', 'Sequences & Series', 'Trigonometry',
    'Limits & Continuity', 'Differentiability & Derivatives', 'Application of Derivatives', 'Integrals',
    'Differential Equations', 'Straight Lines', 'Circles', 'Conic Sections', '3D Geometry', 'Vectors',
    'Probability', 'Statistics', 'Mathematical Reasoning'
  ]
}
