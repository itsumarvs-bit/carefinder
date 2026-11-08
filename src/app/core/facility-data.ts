import { Facility } from '../models/facility.model';

export const demoFacilities: Facility[] = [
  {
    id: 'demo-hospital', name: 'Sample Community Hospital', category: 'hospital',
    description: 'Demonstration record. Replace with facility information verified by your organization.',
    address: '100 Sample Road, Barangay Central', city: 'Sample City', province: 'Sample Province',
    contactNumber: '+63 2 8000 0001', services: ['Emergency care', 'Outpatient consultation'],
    latitude: 14.5995, longitude: 120.9842, isVerified: false, isActive: true, isSample: true,
  },
  {
    id: 'demo-clinic', name: 'Sample Family Clinic', category: 'clinic',
    description: 'Demonstration record. Facility details and coordinates are illustrative only.',
    address: '25 Example Street, Barangay North', city: 'Sample City', province: 'Sample Province',
    contactNumber: '+63 2 8000 0002', services: ['Primary care', 'Health screening'],
    latitude: 14.606, longitude: 120.99, isVerified: false, isActive: true, isSample: true,
  },
  {
    id: 'demo-pharmacy', name: 'Sample Neighborhood Pharmacy', category: 'pharmacy',
    description: 'Demonstration record. Not a real-world facility listing.',
    address: '8 Demo Avenue, Barangay South', city: 'Sample City', province: 'Sample Province',
    contactNumber: '+63 2 8000 0003', services: ['Prescription dispensing', 'Over-the-counter medicines'],
    latitude: 14.593, longitude: 120.978, isVerified: false, isActive: true, isSample: true,
  },
  {
    id: 'demo-health-center', name: 'Sample Barangay Health Center', category: 'health_center',
    description: 'Demonstration record. Replace with locally validated facility information.',
    address: '3 Community Lane, Barangay West', city: 'Sample City', province: 'Sample Province',
    services: ['Community health services', 'Vaccination information'],
    latitude: 14.602, longitude: 120.972, isVerified: false, isActive: true, isSample: true,
  },
];
