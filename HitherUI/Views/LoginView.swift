import SwiftUI

struct LoginView: View {
    @State private var email = ""
    @State private var password = ""
    @State private var showRegister = false
    
    let onSignInTapped: () -> Void
    
    init(onSignInTapped: @escaping () -> Void = {}) {
        self.onSignInTapped = onSignInTapped
    }
    
    var body: some View {
        ScrollView {
            VStack(spacing: HitherDesignSystem.Spacing.xl) {
                Spacer(minLength: 60)
                
                // App Icon
                ZStack {
                    Circle()
                        .fill(HitherDesignSystem.Colors.blue)
                        .frame(width: 120, height: 120)
                    
                    Image(systemName: "square.stack.3d.up")
                        .font(.system(size: 50, weight: .medium))
                        .foregroundColor(.white)
                }
                .padding(.bottom, HitherDesignSystem.Spacing.md)
                
                // Welcome Text
                VStack(spacing: HitherDesignSystem.Spacing.sm) {
                    Text("Welcome Back")
                        .font(HitherDesignSystem.Typography.largeTitle)
                        .foregroundColor(HitherDesignSystem.Colors.gray900)
                    
                    Text("Sign in to continue managing your team.")
                        .font(HitherDesignSystem.Typography.body)
                        .foregroundColor(HitherDesignSystem.Colors.gray500)
                        .multilineTextAlignment(.center)
                }
                .padding(.bottom, HitherDesignSystem.Spacing.xl)
                
                // Input Fields
                VStack(spacing: HitherDesignSystem.Spacing.lg) {
                    VStack(alignment: .leading, spacing: HitherDesignSystem.Spacing.sm) {
                        Text("Email")
                            .font(HitherDesignSystem.Typography.body)
                            .foregroundColor(HitherDesignSystem.Colors.gray700)
                        
                        TextField("you@example.com", text: $email)
                            .textFieldStyle(HitherTextFieldStyle())
                            .keyboardType(.emailAddress)
                            .autocapitalization(.none)
                    }
                    
                    VStack(alignment: .leading, spacing: HitherDesignSystem.Spacing.sm) {
                        Text("Password")
                            .font(HitherDesignSystem.Typography.body)
                            .foregroundColor(HitherDesignSystem.Colors.gray700)
                        
                        SecureField("••••••••", text: $password)
                            .textFieldStyle(HitherTextFieldStyle())
                    }
                }
                
                // Sign In Button
                Button(action: onSignInTapped) {
                    Text("Sign In")
                        .frame(maxWidth: .infinity)
                }
                .hitherPrimaryButton()
                
                // Register Button
                Button("Register") {
                    showRegister = true
                }
                .hitherSecondaryButton()
                
                // Divider
                VStack(spacing: HitherDesignSystem.Spacing.lg) {
                    Text("Or continue with")
                        .font(HitherDesignSystem.Typography.callout)
                        .foregroundColor(HitherDesignSystem.Colors.gray500)
                    
                    // Social Login Buttons
                    VStack(spacing: HitherDesignSystem.Spacing.md) {
                        Button(action: {}) {
                            HStack(spacing: HitherDesignSystem.Spacing.md) {
                                Text("G")
                                    .font(.system(size: 18, weight: .bold))
                                    .foregroundColor(HitherDesignSystem.Colors.gray600)
                                    .frame(width: 18, height: 18)
                                
                                Text("Sign in with Google")
                                    .font(HitherDesignSystem.Typography.headline)
                                    .foregroundColor(HitherDesignSystem.Colors.gray700)
                            }
                            .frame(maxWidth: .infinity)
                        }
                        .hitherSecondaryButton()
                        
                        Button(action: {}) {
                            HStack(spacing: HitherDesignSystem.Spacing.md) {
                                Image(systemName: "applelogo")
                                    .font(.system(size: 18))
                                    .foregroundColor(.white)
                                
                                Text("Sign in with Apple")
                                    .font(HitherDesignSystem.Typography.headline)
                                    .foregroundColor(.white)
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, HitherDesignSystem.Spacing.md)
                            .padding(.horizontal, HitherDesignSystem.Spacing.lg)
                            .background(Color.black)
                            .cornerRadius(HitherDesignSystem.CornerRadius.medium)
                        }
                    }
                }
                
                Spacer(minLength: 40)
                
                // Terms Text
                Text("By continuing, you agree to our Terms of Service and Privacy Policy.")
                    .font(HitherDesignSystem.Typography.footnote)
                    .foregroundColor(HitherDesignSystem.Colors.gray400)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, HitherDesignSystem.Spacing.lg)
            }
            .padding(.horizontal, HitherDesignSystem.Spacing.lg)
        }
        .background(Color.white)
        .sheet(isPresented: $showRegister) {
            RegisterView()
        }
    }
}

struct HitherTextFieldStyle: TextFieldStyle {
    func _body(configuration: TextField<Self._Label>) -> some View {
        configuration
            .padding(.vertical, HitherDesignSystem.Spacing.md)
            .padding(.horizontal, HitherDesignSystem.Spacing.md)
            .background(Color.white)
            .overlay(
                RoundedRectangle(cornerRadius: HitherDesignSystem.CornerRadius.medium)
                    .stroke(HitherDesignSystem.Colors.gray300, lineWidth: 1)
            )
            .cornerRadius(HitherDesignSystem.CornerRadius.medium)
            .font(HitherDesignSystem.Typography.body)
    }
}

struct RegisterView: View {
    @Environment(\.dismiss) var dismiss
    @State private var email = ""
    @State private var password = ""
    @State private var confirmPassword = ""
    
    var body: some View {
        NavigationView {
            ScrollView {
                VStack(spacing: HitherDesignSystem.Spacing.lg) {
                    Text("Create Account")
                        .font(HitherDesignSystem.Typography.title1)
                        .foregroundColor(HitherDesignSystem.Colors.gray900)
                        .padding(.top, HitherDesignSystem.Spacing.xl)
                    
                    VStack(spacing: HitherDesignSystem.Spacing.lg) {
                        VStack(alignment: .leading, spacing: HitherDesignSystem.Spacing.sm) {
                            Text("Email")
                                .font(HitherDesignSystem.Typography.body)
                                .foregroundColor(HitherDesignSystem.Colors.gray700)
                            
                            TextField("you@example.com", text: $email)
                                .textFieldStyle(HitherTextFieldStyle())
                                .keyboardType(.emailAddress)
                                .autocapitalization(.none)
                        }
                        
                        VStack(alignment: .leading, spacing: HitherDesignSystem.Spacing.sm) {
                            Text("Password")
                                .font(HitherDesignSystem.Typography.body)
                                .foregroundColor(HitherDesignSystem.Colors.gray700)
                            
                            SecureField("••••••••", text: $password)
                                .textFieldStyle(HitherTextFieldStyle())
                        }
                        
                        VStack(alignment: .leading, spacing: HitherDesignSystem.Spacing.sm) {
                            Text("Confirm Password")
                                .font(HitherDesignSystem.Typography.body)
                                .foregroundColor(HitherDesignSystem.Colors.gray700)
                            
                            SecureField("••••••••", text: $confirmPassword)
                                .textFieldStyle(HitherTextFieldStyle())
                        }
                    }
                    
                    Button("Create Account") {
                        // Handle registration
                        dismiss()
                    }
                    .hitherPrimaryButton()
                    
                    Spacer()
                }
                .padding(.horizontal, HitherDesignSystem.Spacing.lg)
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .navigationBarTrailing) {
                    Button("Done") {
                        dismiss()
                    }
                    .foregroundColor(HitherDesignSystem.Colors.primary)
                }
            }
        }
    }
}

#Preview("Login View") {
    LoginView(onSignInTapped: {
        print("Preview: Sign in tapped")
    })
}

#Preview("Register Modal") {
    LoginView(onSignInTapped: {
        print("Preview: Sign in tapped")
    })
    .onAppear {
        // This preview shows the register modal
    }
}