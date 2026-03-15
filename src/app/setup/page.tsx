'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Progress } from '@/components/ui/progress';
import { Check, Building2, User, Shield, ArrowRight, ArrowLeft } from 'lucide-react';

type SetupStep = 'organization' | 'admin' | 'security' | 'complete';

interface SetupData {
  organizationName: string;
  organizationSlug: string;
  adminFirstName: string;
  adminLastName: string;
  adminEmail: string;
  adminPassword: string;
  confirmPassword: string;
}

const steps: { key: SetupStep; label: string; icon: React.ElementType }[] = [
  { key: 'organization', label: 'Organization', icon: Building2 },
  { key: 'admin', label: 'Admin Account', icon: User },
  { key: 'security', label: 'Security', icon: Shield },
  { key: 'complete', label: 'Complete', icon: Check },
];

export default function SetupWizardPage() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = React.useState<SetupStep>('organization');
  const [isLoading, setIsLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [data, setData] = React.useState<SetupData>({
    organizationName: '',
    organizationSlug: '',
    adminFirstName: '',
    adminLastName: '',
    adminEmail: '',
    adminPassword: '',
    confirmPassword: '',
  });

  const currentStepIndex = steps.findIndex((s) => s.key === currentStep);
  const progress = ((currentStepIndex + 1) / steps.length) * 100;

  const updateData = (field: keyof SetupData, value: string) => {
    setData((prev) => ({ ...prev, [field]: value }));
    setError(null);
  };

  const generateSlug = (name: string) => {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  };

  const handleOrganizationNameChange = (value: string) => {
    updateData('organizationName', value);
    if (!data.organizationSlug || data.organizationSlug === generateSlug(data.organizationName)) {
      updateData('organizationSlug', generateSlug(value));
    }
  };

  const validateStep = (): boolean => {
    switch (currentStep) {
      case 'organization':
        if (!data.organizationName.trim()) {
          setError('Organization name is required');
          return false;
        }
        if (!data.organizationSlug.trim()) {
          setError('Organization slug is required');
          return false;
        }
        if (!/^[a-z0-9-]+$/.test(data.organizationSlug)) {
          setError('Slug can only contain lowercase letters, numbers, and hyphens');
          return false;
        }
        return true;

      case 'admin':
        if (!data.adminFirstName.trim()) {
          setError('First name is required');
          return false;
        }
        if (!data.adminLastName.trim()) {
          setError('Last name is required');
          return false;
        }
        if (!data.adminEmail.trim()) {
          setError('Email is required');
          return false;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.adminEmail)) {
          setError('Please enter a valid email address');
          return false;
        }
        return true;

      case 'security':
        if (data.adminPassword.length < 8) {
          setError('Password must be at least 8 characters');
          return false;
        }
        if (data.adminPassword !== data.confirmPassword) {
          setError('Passwords do not match');
          return false;
        }
        return true;

      default:
        return true;
    }
  };

  const handleNext = async () => {
    if (!validateStep()) {
      return;
    }

    if (currentStep === 'security') {
      await handleSubmit();
    } else {
      const nextIndex = currentStepIndex + 1;
      const nextStep = steps[nextIndex];
      if (nextIndex < steps.length && nextStep) {
        setCurrentStep(nextStep.key);
      }
    }
  };

  const handleBack = () => {
    const prevIndex = currentStepIndex - 1;
    const prevStep = steps[prevIndex];
    if (prevIndex >= 0 && prevStep) {
      setCurrentStep(prevStep.key);
    }
  };

  const handleSubmit = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          organizationName: data.organizationName,
          organizationSlug: data.organizationSlug,
          adminFirstName: data.adminFirstName,
          adminLastName: data.adminLastName,
          adminEmail: data.adminEmail,
          adminPassword: data.adminPassword,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Setup failed');
      }

      setCurrentStep('complete');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const handleFinish = () => {
    router.push('/rooms');
  };

  return (
    <div className="min-h-screen bg-neutral-50 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-primary-600 text-white font-bold text-xl mb-4">
            V
          </div>
          <h1 className="text-2xl font-bold text-neutral-900">VaultSpace Setup</h1>
          <p className="text-neutral-500 mt-1">Configure your secure data room</p>
        </div>

        {/* Progress */}
        <div className="mb-8">
          <Progress value={progress} className="h-2" />
          <div className="flex justify-between mt-4">
            {steps.map((step, index) => {
              const isActive = step.key === currentStep;
              const isComplete = index < currentStepIndex;
              const Icon = step.icon;

              return (
                <div
                  key={step.key}
                  className={`flex flex-col items-center ${
                    isActive
                      ? 'text-primary-600'
                      : isComplete
                        ? 'text-success-600'
                        : 'text-neutral-400'
                  }`}
                >
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center mb-2 ${
                      isActive
                        ? 'bg-primary-100 text-primary-600'
                        : isComplete
                          ? 'bg-success-100 text-success-600'
                          : 'bg-neutral-100 text-neutral-400'
                    }`}
                  >
                    {isComplete ? <Check className="w-5 h-5" /> : <Icon className="w-5 h-5" />}
                  </div>
                  <span className="text-sm font-medium hidden sm:block">{step.label}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Step Content */}
        <Card>
          <CardHeader>
            <CardTitle>
              {currentStep === 'organization' && 'Create Your Organization'}
              {currentStep === 'admin' && 'Create Admin Account'}
              {currentStep === 'security' && 'Set Up Security'}
              {currentStep === 'complete' && 'Setup Complete!'}
            </CardTitle>
            <CardDescription>
              {currentStep === 'organization' &&
                'Enter the name of your organization. This will be displayed throughout VaultSpace.'}
              {currentStep === 'admin' &&
                'Create the administrator account that will manage your data rooms.'}
              {currentStep === 'security' && 'Set a secure password for your admin account.'}
              {currentStep === 'complete' &&
                'Your VaultSpace instance is ready. You can now start creating data rooms.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {error && (
              <Alert variant="destructive" className="mb-6">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {currentStep === 'organization' && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="orgName">Organization Name</Label>
                  <Input
                    id="orgName"
                    placeholder="Acme Corporation"
                    value={data.organizationName}
                    onChange={(e) => handleOrganizationNameChange(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="orgSlug">Organization Slug</Label>
                  <Input
                    id="orgSlug"
                    placeholder="acme-corp"
                    value={data.organizationSlug}
                    onChange={(e) => updateData('organizationSlug', e.target.value)}
                  />
                  <p className="text-xs text-neutral-500">
                    Used in URLs. Only lowercase letters, numbers, and hyphens.
                  </p>
                </div>
              </div>
            )}

            {currentStep === 'admin' && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="firstName">First Name</Label>
                    <Input
                      id="firstName"
                      placeholder="John"
                      value={data.adminFirstName}
                      onChange={(e) => updateData('adminFirstName', e.target.value)}
                      autoFocus
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="lastName">Last Name</Label>
                    <Input
                      id="lastName"
                      placeholder="Smith"
                      value={data.adminLastName}
                      onChange={(e) => updateData('adminLastName', e.target.value)}
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email Address</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="john@acme.com"
                    value={data.adminEmail}
                    onChange={(e) => updateData('adminEmail', e.target.value)}
                  />
                </div>
              </div>
            )}

            {currentStep === 'security' && (
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="password">Password</Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="Enter a secure password"
                    value={data.adminPassword}
                    onChange={(e) => updateData('adminPassword', e.target.value)}
                    autoFocus
                  />
                  <p className="text-xs text-neutral-500">Must be at least 8 characters</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirmPassword">Confirm Password</Label>
                  <Input
                    id="confirmPassword"
                    type="password"
                    placeholder="Confirm your password"
                    value={data.confirmPassword}
                    onChange={(e) => updateData('confirmPassword', e.target.value)}
                  />
                </div>
              </div>
            )}

            {currentStep === 'complete' && (
              <div className="text-center py-6">
                <div className="mx-auto w-16 h-16 rounded-full bg-success-100 flex items-center justify-center mb-4">
                  <Check className="w-8 h-8 text-success-600" />
                </div>
                <p className="text-neutral-600 mb-4">
                  Your organization <strong>{data.organizationName}</strong> has been created
                  successfully.
                </p>
                <p className="text-sm text-neutral-500">
                  You can now sign in with your admin credentials and start creating data rooms.
                </p>
              </div>
            )}

            {/* Actions */}
            <div className="flex justify-between mt-8">
              {currentStep !== 'complete' && currentStepIndex > 0 && (
                <Button variant="outline" onClick={handleBack} disabled={isLoading}>
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back
                </Button>
              )}
              {currentStep !== 'complete' && currentStepIndex === 0 && <div />}

              {currentStep !== 'complete' ? (
                <Button onClick={handleNext} loading={isLoading}>
                  {currentStep === 'security' ? 'Complete Setup' : 'Continue'}
                  {currentStep !== 'security' && <ArrowRight className="w-4 h-4 ml-2" />}
                </Button>
              ) : (
                <Button onClick={handleFinish} className="mx-auto">
                  Go to Dashboard
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
