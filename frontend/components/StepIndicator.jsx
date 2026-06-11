const StepIndicator = ({ currentStep, totalSteps = 4 }) => {
  return (
    <div className="step-indicator">
      {Array.from({ length: totalSteps }, (_, i) => (
        <div key={i} className="step-wrapper">
          <div className={`step-circle ${
            i < currentStep ? 'completed' :
            i === currentStep ? 'active' : 'inactive'
          }`}>
            {i < currentStep ? '✓' : ''}
          </div>
          {i < totalSteps - 1 && (
            <div className={`step-line ${i < currentStep ? 'completed' : ''}`} />
          )}
        </div>
      ))}
    </div>
  );
};

export default StepIndicator;
